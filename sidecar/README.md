# WhisperGlass sidecar — FastAPI transcription server (Python 3.12) spawned by the Electron main process on 127.0.0.1. The venv is bootstrapped externally. torch is intentionally NOT in requirements.txt: the bootstrap installs CPU-only torch first (whisperx 3.8.x pins torch~=2.8) from https://download.pytorch.org/whl/cpu so the multi-GB CUDA wheel is never pulled.

| Endpoint | Response |
|---|---|
| `GET /health` | `{ok, gpu_available, gpu_name, vram_free_mb, loaded_model, version}` |
| `POST /transcribe` | body per CONTRACTS.md §4 → `{ok, text, language, duration, elapsed, segments, words}` or `{ok:false, error, kind}` (busy → HTTP 409) |
| `GET /models?root=<dir>` | `{ok, models:[{repo, on_disk_mb}]}` (disk scan) |
| `POST /models/download` `{repo, root}` | `{ok, path}` — blocking; poll `GET /models/progress?repo=…` → `{repo, bytes, total, done, error}` |
| `POST /models/delete` `{path}` · `POST /unload` · `POST /shutdown` | `{ok}` (delete refuses paths outside the models root) |

```
uv venv venv --python 3.12
uv pip install --python venv/bin/python torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cpu && uv pip install --python venv/bin/python -r requirements.txt
LD_LIBRARY_PATH="venv/lib/python3.12/site-packages/nvidia/cublas/lib:venv/lib/python3.12/site-packages/nvidia/cudnn/lib" venv/bin/python server.py --port 7345 --models-root ~/.local/share/whisperglass/models
```
