"""Model catalog constants, download progress tracking, and disk helpers (framework-free)."""

import os
import re
import shutil
import threading
from pathlib import Path

MODEL_CATALOG = (
    {"key": "tiny.en", "name": "Tiny (English)", "repo": "Systran/faster-whisper-tiny.en", "size_mb": 75, "multilingual": False},
    {"key": "base.en", "name": "Base (English)", "repo": "Systran/faster-whisper-base.en", "size_mb": 145, "multilingual": False},
    {"key": "small.en", "name": "Small (English)", "repo": "Systran/faster-whisper-small.en", "size_mb": 485, "multilingual": False},
    {"key": "small", "name": "Small (Multilingual)", "repo": "Systran/faster-whisper-small", "size_mb": 485, "multilingual": True},
    {"key": "medium.en", "name": "Medium (English)", "repo": "Systran/faster-whisper-medium.en", "size_mb": 1500, "multilingual": False},
    {"key": "medium", "name": "Medium (Multilingual)", "repo": "Systran/faster-whisper-medium", "size_mb": 1500, "multilingual": True},
    {"key": "turbo", "name": "Turbo", "repo": "deepdml/faster-whisper-large-v3-turbo-ct2", "size_mb": 1600, "multilingual": True},
    {"key": "distil-large-v3", "name": "Distil Large v3", "repo": "Systran/faster-distil-whisper-large-v3", "size_mb": 1500, "multilingual": False},
    {"key": "large-v3", "name": "Large v3", "repo": "Systran/faster-whisper-large-v3", "size_mb": 3100, "multilingual": True},
)

# sidecar-internal dirs under the models root that are not user models
_INTERNAL_DIRS = {"align", "diarize"}


class DeleteRefused(ValueError):
    pass


def safe_repo_dir(repo: str) -> str:
    name = str(repo).strip().strip("/").replace("/", "__")
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    return name or "model"


def repo_from_dirname(name: str) -> str:
    return name.replace("__", "/") if "__" in name else name


def dir_size_bytes(path, include_cache: bool = False) -> int:
    total = 0
    for dirpath, dirnames, filenames in os.walk(path):
        if not include_cache:
            dirnames[:] = [d for d in dirnames if d not in (".cache", ".locks")]
        for fname in filenames:
            try:
                total += os.path.getsize(os.path.join(dirpath, fname))
            except OSError:
                pass
    return total


def scan_models(root) -> list:
    root = Path(root)
    found = []
    if not root.is_dir():
        return found
    for child in sorted(root.iterdir()):
        if not child.is_dir() or child.name.startswith(".") or child.name in _INTERNAL_DIRS:
            continue
        found.append(
            {"repo": repo_from_dirname(child.name), "on_disk_mb": round(dir_size_bytes(child) / 1048576, 1)}
        )
    return found


class ProgressTracker:
    """Thread-safe in-memory download progress: repo -> {bytes, total, done, error}."""

    def __init__(self):
        self._lock = threading.Lock()
        self._entries: dict = {}

    def start(self, repo: str) -> None:
        with self._lock:
            self._entries[repo] = {"bytes": 0, "total": 0, "done": False, "error": None}

    def get(self, repo: str):
        with self._lock:
            entry = self._entries.get(repo)
            return dict(entry) if entry is not None else None

    def set_total(self, repo: str, total: int) -> None:
        with self._lock:
            entry = self._entries.get(repo)
            if entry is not None:
                entry["total"] = max(int(total), 0)

    def set_bytes(self, repo: str, nbytes: int) -> None:
        with self._lock:
            entry = self._entries.get(repo)
            if entry is not None:
                entry["bytes"] = max(int(nbytes), 0)

    def finish(self, repo: str, final_bytes=None) -> None:
        with self._lock:
            entry = self._entries.get(repo)
            if entry is None:
                return
            if final_bytes is not None:
                entry["bytes"] = int(final_bytes)
            if entry["total"] <= 0 < entry["bytes"]:
                entry["total"] = entry["bytes"]
            entry["done"] = True
            entry["error"] = None

    def fail(self, repo: str, error: str) -> None:
        with self._lock:
            entry = self._entries.get(repo)
            if entry is not None:
                entry["done"] = True
                entry["error"] = str(error)

    def snapshot(self) -> dict:
        with self._lock:
            return {repo: dict(entry) for repo, entry in self._entries.items()}


def _repo_size_bytes(repo: str) -> int:
    try:
        from huggingface_hub import HfApi

        info = HfApi().model_info(repo, files_metadata=True)
        return int(sum((sibling.size or 0) for sibling in (info.siblings or [])))
    except Exception:
        return 0


def download_model(repo: str, root, tracker: ProgressTracker) -> Path:
    """Blocking snapshot_download into <root>/<safe_repo_dir>; updates tracker with byte progress."""
    from huggingface_hub import snapshot_download

    dest = Path(root) / safe_repo_dir(repo)
    tracker.start(repo)
    stop = threading.Event()

    def watch():
        while not stop.wait(0.4):
            # include .cache: in-flight local_dir downloads hold the *.incomplete files there
            tracker.set_bytes(repo, dir_size_bytes(dest, include_cache=True))

    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    try:
        tracker.set_total(repo, _repo_size_bytes(repo))
        snapshot_download(repo_id=repo, local_dir=str(dest))
        tracker.finish(repo, dir_size_bytes(dest))
        return dest
    except Exception as exc:
        tracker.fail(repo, f"{type(exc).__name__}: {exc}")
        raise
    finally:
        stop.set()
        watcher.join(timeout=2)


def delete_model(path, models_root) -> None:
    """Best-effort rmtree/unlink; raises DeleteRefused for paths outside models_root."""
    if path is None or not str(path).strip():
        raise DeleteRefused("No path given.")
    root = Path(models_root).expanduser().resolve()
    target = Path(str(path).strip()).expanduser().resolve()
    if target == root or not target.is_relative_to(root):
        raise DeleteRefused(f"Refusing to delete '{target}': outside models root '{root}'.")
    if not target.exists() and not target.is_symlink():
        return
    if target.is_symlink() or target.is_file():
        target.unlink(missing_ok=True)
    else:
        shutil.rmtree(target)
