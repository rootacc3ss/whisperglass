"""WhisperGlass sidecar: FastAPI transcription server run by the Electron main process."""

import argparse
import asyncio
import logging
import os
import signal
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

import engines
import models

VERSION = "1.0.0"

# keep the log clean: no HF progress bars / tokenizer fork warnings
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

logger = logging.getLogger("whisperglass.sidecar")

DEFAULT_MODELS_ROOT = Path.home() / ".local/share/whisperglass/models"

app = FastAPI(title="WhisperGlass sidecar", version=VERSION)
app.state.models_root = str(DEFAULT_MODELS_ROOT)
ENGINES = engines.Engines(DEFAULT_MODELS_ROOT)
TRACKER = models.ProgressTracker()
TRANSCRIBE_LOCK = asyncio.Lock()
DOWNLOAD_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="wg-download")


def _nvidia_smi():
    try:
        proc = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.free", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            parts = proc.stdout.strip().splitlines()[0].split(",")
            if len(parts) >= 2:
                return parts[0].strip(), int(float(parts[1].strip()))
    except Exception:
        pass
    return "", 0


def _gpu_state():
    available = False
    try:
        import ctranslate2

        available = ctranslate2.get_cuda_device_count() > 0
    except Exception:
        available = False
    name, vram_free_mb = _nvidia_smi()
    return available, name, vram_free_mb


@app.get("/health")
async def health():
    loop = asyncio.get_running_loop()
    gpu_available, gpu_name, vram_free_mb = await loop.run_in_executor(None, _gpu_state)
    return {
        "ok": True,
        "gpu_available": gpu_available,
        "gpu_name": gpu_name,
        "vram_free_mb": vram_free_mb,
        "loaded_model": ENGINES.loaded_model,
        "version": VERSION,
    }


@app.post("/transcribe")
async def transcribe(payload: dict):
    wav_path = payload.get("wav_path")
    if not wav_path or not os.path.isfile(str(wav_path)):
        return {"ok": False, "error": f"Audio file not found: '{wav_path}'.", "kind": "internal"}
    if TRANSCRIBE_LOCK.locked():
        return JSONResponse(
            status_code=409,
            content={"ok": False, "kind": "busy", "error": "A transcription is already running."},
        )
    async with TRANSCRIBE_LOCK:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, ENGINES.transcribe, dict(payload))
    return result


@app.get("/models")
async def list_models(request: Request, root: str | None = None):
    target = root if root else request.app.state.models_root
    loop = asyncio.get_running_loop()
    entries = await loop.run_in_executor(None, models.scan_models, target)
    return {"ok": True, "models": entries}


@app.post("/models/download")
async def download_model(request: Request, payload: dict):
    repo = str(payload.get("repo") or "").strip()
    root = payload.get("root") or request.app.state.models_root
    if not repo:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Missing 'repo'."})
    TRACKER.start(repo)
    loop = asyncio.get_running_loop()
    try:
        path = await loop.run_in_executor(DOWNLOAD_POOL, models.download_model, repo, root, TRACKER)
    except Exception as exc:
        logger.exception("model download failed: %s", repo)
        if engines.looks_like_auth_failure(exc):
            return JSONResponse(
                status_code=500,
                content={"ok": False, "error": engines.auth_error_message(), "kind": "auth"},
            )
        message = f"{type(exc).__name__}: {exc}".strip() or type(exc).__name__
        return JSONResponse(status_code=500, content={"ok": False, "error": message[:1000], "kind": "internal"})
    return {"ok": True, "path": str(path)}


@app.get("/models/progress")
async def download_progress(repo: str | None = None):
    if repo:
        entry = TRACKER.get(repo)
        if entry is None:
            entry = {"bytes": 0, "total": 0, "done": False, "error": None, "pending": True}
        return {"repo": repo, **entry}
    return {"downloads": TRACKER.snapshot()}


@app.post("/models/delete")
async def delete_model(request: Request, payload: dict):
    try:
        models.delete_model(payload.get("path"), request.app.state.models_root)
    except models.DeleteRefused as exc:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(exc)})
    except OSError as exc:
        return JSONResponse(status_code=500, content={"ok": False, "error": f"Failed to delete: {exc}"})
    return {"ok": True}


@app.post("/unload")
async def unload():
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, ENGINES.unload_all)
    return {"ok": True}


@app.post("/shutdown")
async def shutdown():
    asyncio.get_running_loop().call_later(0.3, _terminate)
    return {"ok": True}


def _terminate():
    os.kill(os.getpid(), signal.SIGTERM)


def main() -> None:
    parser = argparse.ArgumentParser(description="WhisperGlass transcription sidecar")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--models-root", required=True)
    args = parser.parse_args()

    verbose = os.environ.get("WG_VERBOSE") == "1"
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    models_root = Path(args.models_root).expanduser()
    models_root.mkdir(parents=True, exist_ok=True)
    app.state.models_root = str(models_root)
    global ENGINES
    ENGINES = engines.Engines(models_root)

    import uvicorn

    verbose = os.environ.get("WG_VERBOSE") == "1"
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="debug" if verbose else "warning", access_log=verbose)


if __name__ == "__main__":
    main()
