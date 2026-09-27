"""Model manager: warm model cache + whisper/whisperx transcription pipelines."""

import gc
import logging
import os
import re
import sys
import threading
import time
import wave
from pathlib import Path

logger = logging.getLogger("whisperglass.engines")

ENGINES = ("whisper", "whisperx")

_AUTH_MARKERS = (
    "unauthorized",
    "401",
    "403",
    "unauthenticated",
    "must be authenticated",
    "gated repo",
    "restricted",
    "authentication",
)


class TranscribeError(Exception):
    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind
        self.message = message


def looks_like_auth_failure(exc: BaseException) -> bool:
    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    if status in (401, 403):
        return True
    text = f"{type(exc).__name__} {exc}".lower()
    return any(marker in text for marker in _AUTH_MARKERS)


def looks_like_oom(exc: BaseException) -> bool:
    if "outofmemory" in type(exc).__name__.lower():
        return True
    text = f"{type(exc).__name__} {exc}".lower()
    return "out of memory" in text or re.search(r"(?<![a-z])oom(?![a-z])", text) is not None


def auth_error_message() -> str:
    return (
        "HuggingFace authentication failed. Check the token in Settings, and make sure you have "
        "accepted the license conditions for the pyannote models on huggingface.co "
        "(pyannote/speaker-diarization-community-1 and pyannote/segmentation-3.0)."
    )


def oom_error_message() -> str:
    return "Ran out of GPU memory. Try a smaller model, the 'int8' compute type, or the CPU device."


def _ensure_nltk_punkt() -> None:
    import os

    try:
        import nltk

        nltk.data.find("tokenizers/punkt_tab")
        return
    except LookupError:
        pass
    except Exception:
        return
    try:
        import nltk

        if nltk.download("punkt_tab", quiet=True):
            return
    except Exception:
        pass
    try:
        import io
        import urllib.request
        import zipfile

        dest = os.path.expanduser("~/nltk_data/tokenizers")
        os.makedirs(dest, exist_ok=True)
        url = "https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/tokenizers/punkt_tab.zip"
        with urllib.request.urlopen(url, timeout=90) as resp:
            with zipfile.ZipFile(io.BytesIO(resp.read())) as zf:
                zf.extractall(dest)
    except Exception:
        pass


def _optional_int(value):
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _round3(value, default=0.0) -> float:
    try:
        return round(float(value), 3)
    except (TypeError, ValueError):
        return default


def _unwrap_text(text):
    if isinstance(text, list):
        return str(text[0]) if text else ""
    return str(text) if text is not None else ""


class Engines:
    def __init__(self, models_root):
        self.models_root = Path(models_root)
        self._lock = threading.Lock()
        self._whisper_models = {}
        self._whisper_mru = []
        self._whisperx_pipelines = {}
        self._whisperx_mru = []
        self._loaded_path = None
        self._align_cache = {}
        self._diarizer = None
        self._diarizer_token = None
        self._cuda = None

    @property
    def loaded_model(self) -> str:
        return self._loaded_path.name if self._loaded_path is not None else ""

    def _get_cached(self, cache, mru, key, loader):
        if key in cache:
            mru.remove(key)
            mru.append(key)
            return cache[key]
        model = loader()
        cache[key] = model
        mru.append(key)
        while len(mru) > 2:
            old = mru.pop(0)
            cache.pop(old, None)
            gc.collect()
            self._empty_cuda_cache()
            logger.info("evicted idle model from cache: %s", old)
        return model

    def cuda_available(self) -> bool:
        if self._cuda is None:
            try:
                import ctranslate2

                self._cuda = ctranslate2.get_cuda_device_count() > 0
            except Exception:
                self._cuda = False
        return self._cuda

    def unload_all(self) -> None:
        with self._lock:
            self._whisper_models.clear()
            self._whisper_mru.clear()
            self._whisperx_pipelines.clear()
            self._whisperx_mru.clear()
            self._align_cache.clear()
            self._diarizer = None
            self._diarizer_token = None
            gc.collect()
            self._empty_cuda_cache()
            logger.info("unloaded all models")

    @staticmethod
    def _empty_cuda_cache() -> None:
        torch = sys.modules.get("torch")
        if torch is None:
            return
        try:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def transcribe(self, params: dict) -> dict:
        started = time.perf_counter()
        try:
            with self._lock:
                result = self._run(params)
        except TranscribeError as exc:
            logger.warning("transcribe error (%s): %s", exc.kind, exc.message)
            return {"ok": False, "error": exc.message, "kind": exc.kind}
        except Exception as exc:
            logger.exception("transcribe failed")
            if looks_like_oom(exc):
                return {"ok": False, "error": oom_error_message(), "kind": "oom"}
            if looks_like_auth_failure(exc):
                return {"ok": False, "error": auth_error_message(), "kind": "auth"}
            message = f"{type(exc).__name__}: {exc}".strip() or type(exc).__name__
            return {"ok": False, "error": message[:1000], "kind": "internal"}
        result["elapsed"] = round(time.perf_counter() - started, 3)
        return result

    def _resolve_device(self, requested: str):
        if requested == "auto":
            return ("cuda" if self.cuda_available() else "cpu"), None
        if requested == "cuda":
            if self.cuda_available():
                return "cuda", None
            return "cpu", "CUDA is not available to ctranslate2 — fell back to CPU."
        return "cpu", None

    @staticmethod
    def _resolve_compute(requested: str, device: str):
        if not requested or requested == "auto":
            return ("float16" if device == "cuda" else "int8"), None
        if device == "cpu":
            if requested == "float16":
                return "float32", "float16 is not supported on CPU — using float32."
            if requested == "int8_float16":
                return "int8", "int8_float16 is not supported on CPU — using int8."
        return requested, None

    def _check_model_dir(self, model_path: str) -> None:
        path = Path(model_path)
        if not model_path or not path.is_dir() or not (path / "model.bin").exists():
            raise TranscribeError(
                "model_missing",
                f"Model not found at '{model_path}'. Download it from Settings → Models.",
            )

    def _run(self, params: dict) -> dict:
        engine = str(params.get("engine") or "whisper").lower()
        if engine not in ENGINES:
            raise TranscribeError("internal", f"Unknown engine '{engine}' (expected whisper or whisperx).")
        model_path = str(params.get("model_path") or "")
        self._check_model_dir(model_path)

        language = params.get("language") or None
        if isinstance(language, str) and language.strip().lower() in ("", "auto"):
            language = None
        device, fallback_reason = self._resolve_device(str(params.get("device") or "auto").lower())
        compute, compute_note = self._resolve_compute(str(params.get("compute_type") or "auto"), device)
        if compute_note:
            fallback_reason = f"{fallback_reason} {compute_note}".strip()

        num_speakers = _optional_int(params.get("num_speakers"))
        initial_prompt = str(params.get("initial_prompt") or "")
        # align/diarize only apply to whisperx (whisperx always VADs, so vad_filter is whisper-only)
        align = bool(params.get("align")) and engine == "whisperx"
        diarize = bool(params.get("diarize")) and engine == "whisperx"
        hf_token = str(params.get("hf_token") or "")

        if engine == "whisper":
            result = self._run_whisper(
                wav_path=str(params.get("wav_path") or ""),
                model_path=model_path,
                device=device,
                compute=compute,
                language=language,
                vad_filter=bool(params.get("vad_filter")),
                initial_prompt=initial_prompt,
            )
        else:
            result = self._run_whisperx(
                wav_path=str(params.get("wav_path") or ""),
                model_path=model_path,
                device=device,
                compute=compute,
                language=language,
                align=align,
                diarize=diarize,
                hf_token=hf_token,
                num_speakers=num_speakers,
                initial_prompt=initial_prompt,
            )

        result["device"] = device
        if fallback_reason:
            result["fallback_reason"] = fallback_reason
        return result

    def _run_whisper(self, wav_path, model_path, device, compute, language, vad_filter, initial_prompt):
        key = ("whisper", model_path, device, compute)

        def load():
            logger.info("loading whisper model %s on %s (%s)", model_path, device, compute)
            from faster_whisper import WhisperModel

            return WhisperModel(
                model_path,
                device=device,
                compute_type=compute,
                cpu_threads=max(4, (os.cpu_count() or 8) // 2),
            )

        model = self._get_cached(self._whisper_models, self._whisper_mru, key, load)
        self._loaded_path = Path(model_path)

        segments_iter, info = model.transcribe(
            wav_path,
            language=language,
            vad_filter=vad_filter,
            initial_prompt=initial_prompt or None,
            beam_size=5,
            word_timestamps=True,
        )
        segments_out, words_out, texts = [], [], []
        for segment in segments_iter:
            texts.append(segment.text or "")
            segments_out.append(
                {
                    "start": _round3(segment.start),
                    "end": _round3(segment.end),
                    "text": (segment.text or "").strip(),
                }
            )
            for word in segment.words or []:
                words_out.append(
                    {"word": word.word or "", "start": _round3(word.start), "end": _round3(word.end)}
                )
        return {
            "ok": True,
            "text": "".join(texts).strip(),
            "language": getattr(info, "language", None) or language or "",
            "duration": _round3(getattr(info, "duration", 0.0)),
            "segments": segments_out,
            "words": words_out,
        }

    def _run_whisperx(self, wav_path, model_path, device, compute, language, align, diarize, hf_token, num_speakers, initial_prompt):
        import whisperx

        key = ("whisperx", model_path, device, compute, language, initial_prompt)

        def load():
            logger.info("loading whisperx model %s on %s (%s)", model_path, device, compute)
            kwargs = {
                "compute_type": compute,
                "asr_options": {"initial_prompt": initial_prompt or None},
                # silero runs on CPU torch (pyannote VAD would need CUDA-enabled torch)
                "vad_method": "silero",
            }
            if language is not None:
                kwargs["language"] = language
            return whisperx.load_model(model_path, device, **kwargs)

        pipeline = self._get_cached(self._whisperx_pipelines, self._whisperx_mru, key, load)
        self._loaded_path = Path(model_path)

        audio = self._load_audio(wav_path)
        result = pipeline.transcribe(audio, batch_size=8, language=language)
        segments = [dict(seg) for seg in (result.get("segments") or [])]
        for seg in segments:
            seg["text"] = _unwrap_text(seg.get("text"))
        detected = result.get("language") or language

        if align:
            _ensure_nltk_punkt()
            if not detected:
                raise TranscribeError(
                    "language_unsupported",
                    "Could not detect the audio language; word alignment needs a known, supported language.",
                )
            if not self._language_alignable(detected):
                raise TranscribeError(
                    "language_unsupported", f"Word alignment is not available for language '{detected}'."
                )
            align_model, align_meta = self._get_align_model(detected)
            result = whisperx.align(
                segments, align_model, align_meta, audio, "cpu", return_char_alignments=False
            )
            segments = [dict(seg) for seg in (result.get("segments") or segments)]

        speakers = set()
        if diarize:
            if not hf_token:
                raise TranscribeError(
                    "auth",
                    "Speaker diarization requires a HuggingFace token. Add one in Settings → Transcription.",
                )
            diarizer = self._get_diarizer(hf_token)
            try:
                diarize_segments = diarizer(audio, min_speakers=num_speakers, max_speakers=num_speakers)
            except Exception as exc:
                if looks_like_auth_failure(exc):
                    raise TranscribeError("auth", auth_error_message()) from exc
                raise
            result = whisperx.assign_word_speakers(diarize_segments, result)
            segments = [dict(seg) for seg in (result.get("segments") or segments)]

        segments_out, words_out, texts = [], [], []
        for seg in segments:
            text = _unwrap_text(seg.get("text"))
            texts.append(text)
            speaker = seg.get("speaker")
            if speaker:
                speakers.add(speaker)
            seg_out = {"start": _round3(seg.get("start")), "end": _round3(seg.get("end")), "text": text.strip()}
            if speaker:
                seg_out["speaker"] = speaker
            segments_out.append(seg_out)
            for word in seg.get("words") or []:
                if not isinstance(word, dict):
                    continue
                word_speaker = word.get("speaker")
                if word_speaker:
                    speakers.add(word_speaker)
                word_out = {
                    "word": str(word.get("word") or ""),
                    "start": _round3(word.get("start")),
                    "end": _round3(word.get("end"), word.get("start") or 0.0),
                }
                if word_speaker:
                    word_out["speaker"] = word_speaker
                words_out.append(word_out)

        out = {
            "ok": True,
            "text": "".join(texts).strip(),
            "language": detected or "",
            "duration": round(float(len(audio)) / 16000.0, 3),
            "segments": segments_out,
            "words": words_out,
        }
        if speakers:
            out["speakers"] = sorted(speakers)
        return out

    @staticmethod
    def _load_audio(wav_path: str):
        # main always writes 16 kHz mono PCM16 WAVs; stdlib decode avoids the ffmpeg
        # subprocess that whisperx.load_audio would need (not installed by default on Fedora)
        try:
            with wave.open(wav_path, "rb") as handle:
                if (
                    handle.getcomptype() != "NONE"
                    or handle.getnchannels() != 1
                    or handle.getsampwidth() != 2
                    or handle.getframerate() != 16000
                ):
                    raise ValueError("not a 16 kHz mono PCM16 WAV")
                raw = handle.readframes(handle.getnframes())
            import numpy as np

            return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        except Exception:
            import whisperx

            return whisperx.load_audio(wav_path)

    @staticmethod
    def _language_alignable(language: str) -> bool:
        try:
            from whisperx.alignment import DEFAULT_ALIGN_MODELS_HF, DEFAULT_ALIGN_MODELS_TORCH
        except ImportError:
            try:
                from whisperx.asr import DEFAULT_ALIGN_MODELS_HF, DEFAULT_ALIGN_MODELS_TORCH
            except ImportError:
                return True
        return language in DEFAULT_ALIGN_MODELS_HF or language in DEFAULT_ALIGN_MODELS_TORCH

    def _get_align_model(self, language: str):
        cached = self._align_cache.get(language)
        if cached is not None:
            return cached
        import whisperx

        try:
            model, meta = whisperx.load_align_model(
                language_code=language,
                device="cpu",
                model_dir=str(self.models_root / "align"),
            )
        except ValueError as exc:
            if "align-model" in str(exc).lower() or "no default" in str(exc).lower():
                raise TranscribeError(
                    "language_unsupported", f"Word alignment is not available for language '{language}'."
                ) from exc
            raise
        self._align_cache[language] = (model, meta)
        return model, meta

    def _get_diarizer(self, hf_token: str):
        if self._diarizer is not None and self._diarizer_token == hf_token:
            return self._diarizer
        import inspect

        from whisperx.diarize import DiarizationPipeline

        params = inspect.signature(DiarizationPipeline.__init__).parameters
        kwargs = {"device": "cpu"}
        if "token" in params:
            kwargs["token"] = hf_token
        elif "use_auth_token" in params:
            kwargs["use_auth_token"] = hf_token
        if "cache_dir" in params:
            kwargs["cache_dir"] = str(self.models_root / "diarize")
        self._diarizer = DiarizationPipeline(**kwargs)
        self._diarizer_token = hf_token
        return self._diarizer
