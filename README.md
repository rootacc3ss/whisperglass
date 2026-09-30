# WhisperGlass

A small, transparent, always-on-top speech-to-text overlay for Linux. Press a keybind,
speak, press it again — the transcription appears with a word-by-word reveal and lands
in your clipboard. Powered locally by [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
and [WhisperX](https://github.com/m-bain/whisperX) on CPU or NVIDIA GPU. Nothing leaves your machine.

## Quick start (Fedora / any Linux with npm + uv)

```bash
cd whisperglass
npm install
npm start          # first launch sets up the Python backend (~2 GB, one time)
```

- Frontend: Node 20+ / Electron
- Backend: auto-managed Python 3.12 venv at `~/.local/share/whisperglass/venv`
  (created with [`uv`](https://docs.astral.sh/uv/) — install it with `curl -LsSf https://astral.sh/uv/install.sh | sh` if you don't have it)

On first launch the onboarding view walks you through:

1. **AI backend setup** — automatic; watch the log lines
2. **Device & model** — GPU (CUDA) is auto-detected; pick a model and download it
   (recommended: `turbo` on GPU, `small.en` on CPU)
3. **Done** — the record keybind is shown, finish and go

## Using it

| Keybind | Action |
|---|---|
| `Ctrl+Shift+Space` | Start / stop recording (stop = transcribe) |
| `Ctrl+\` | Hide / show the window |
| `Alt+Shift+T` | Hide / show — **system keybind** (install from Settings → Keybinds; recommended on GNOME Wayland) |
| `Alt+Shift+W` / `Alt+Shift+R` | System keybinds (GNOME): hide/show window · start/stop recording |
| `Ctrl+Shift+N` | New session |
| `Ctrl+Shift+B` | Toggle sessions panel |
| `Escape` | Discard recording / exit edit or settings |

All keybinds are remappable in **Settings → Keybinds** (click a chip, press the combo).

- Every recording becomes an **entry** in the current **session** (chat-style sidebar on
  the left; create / rename / delete sessions like chats)
- When a transcription finishes it's **auto-copied to your clipboard** (toast confirms)
- **Click any transcription** to enter edit mode — the text is fully highlighted so
  `Ctrl+C` copies it instantly, or edit it and the session saves your changes
- Word-level timestamps: hover a word (WhisperX engine), speaker labels with
  diarization (needs a free HuggingFace token)
- **Live transcription** (Settings → Live transcription, off by default): real-time
  partials while you speak — words lock in as they're confirmed, the dim tail is still
  settling. The final pass on stop re-transcribes the whole recording with your full
  settings, so quality never depends on the live preview. A smaller live model
  (e.g. `tiny.en`/`base.en`) keeps partials snappy.
- **Microphone picker** in Settings → Audio, with a live **signal test** (VU meter) so
  you can see which mic actually picks up sound before recording. Devices with a
  stale saved ID auto-fallback to system default; a silence watchdog auto-retries
  on the default if the selected device delivers no signal, and the real captured
  device label is shown while recording.
- **Verbose logging** in Settings → Diagnostics — flip the switch, approve the
  restart popup, and `~/.local/share/whisperglass/whisperglass.log` captures the
  full firehose (device enumeration, getUserMedia constraints, opened-device
  settings, chunk RMS, transcribe summaries — never transcript text). Open /
  copy / tail the log right from the card.

## Hiding & restoring

The window is meant to vanish completely (no taskbar entry), so there are three
restore paths:

1. **Tray icon** (top bar menu: Show / Record / New session / Settings / Quit) —
   needs the AppIndicator extension on GNOME (Settings → Appearance can disable it)
2. **System keybinds** — Settings → Keybinds → Install (GNOME, one click). Registers
   compositor-level keybinds (`Alt+Shift+W` hide/show, `Alt+Shift+R` record by default,
   changeable) that fire even when another app has focus — the in-app grab can't do that
   on Wayland. Existing custom keybindings are preserved, and conflicting bindings from
   other apps are detected and surfaced instead of silently failing. The installer writes
   tiny launchers to `~/.local/bin/whisperglass-*`.
3. **CLI relay** — run the app with `--toggle`, `--show`, `--hide`, or `--record`;
   the command is forwarded to the running instance (works from terminals, docks,
   scripts, other DEs' shortcut settings).

## Engines & devices

- **Whisper** (`faster-whisper`, CTranslate2) — fastest to start, built-in Silero VAD
- **WhisperX** — adds wav2vec2 word alignment (accurate timestamps) + optional
  speaker diarization; VAD runs on CPU torch, ASR runs on GPU via CUDA

Both engines share the same CTranslate2 model files — pick any of tiny → large-v3 /
turbo / distil in **Settings → Models** and switch anytime. Models live in
`~/.local/share/whisperglass/models`.

GPU support ships via pip (`ctranslate2` + `nvidia-cublas-cu12` + `nvidia-cudnn-cu12`);
no system CUDA toolkit needed — your NVIDIA driver (≥ CUDA 12) is enough. `torch` is
deliberately CPU-only (VAD/alignment don't need VRAM), which keeps the install ~10 GB
lighter. If GPU memory runs out mid-transcription you'll get a clear error — switch to
`int8` compute or a smaller model in settings.

## AI assist

Settings → AI Assist: point WhisperGlass at any **OpenAI-compatible** endpoint
(OpenAI, LM Studio, Ollama, anything speaking `/v1/chat/completions`) with an API
key and model ID. Then every transcript gets a ✨ button:

- **Improve clarity & readability** — strips uh/um, stutters and false starts; same
  language, no new content
- **Summarize** — keeps core details
- **Custom prompt** — free-form instruction

Outputs land as **AI OUTPUT** entries in the chat directly below their source
transcript, with prior entries sent as context. "Auto-refine on transcription"
runs *improve* automatically after every recording. Nothing is sent anywhere except
your chosen endpoint.

## Audio archive

Settings → Behavior → **Keep audio files**: recordings are archived per-session at
`~/.local/share/whisperglass/audio/<session>/<entry>.wav` and linked to their entry —
a ▶ button on each entry opens a player, with karaoke-style word highlighting synced
to the timestamps when WhisperX alignment data exists. Deleting an entry (or session)
deletes its audio.

## Files

```
~/.config/whisperglass/            settings.json, window position
~/.local/share/whisperglass/
  venv/        Python backend (auto-managed)
  models/      Whisper models (+ align/ for WhisperX alignment models)
  sessions/    one JSON per session
  audio/       temp WAVs (deleted after transcription unless you enable keep)
  sidecar.log  backend log
```

## Notes & troubleshooting

- **Wayland**: runs via XWayland automatically (transparent + always-on-top are
  reliable there). Native Wayland is an experimental toggle in Settings → Appearance
  (needs restart). In-app global shortcuts can't fire while a native Wayland window
  has focus — install the system keybinds (above) for toggle + record that work
  everywhere, even with the window hidden.
- **Recording while hidden**: start a recording from the system record keybind, the
  tray, or the CLI relay — a tiny status pill appears top-center (recording ·
  transcribing · copied-to-clipboard) even when the overlay is hidden, then fades.
  Click it to bring the overlay back.
- **Tray icon missing on GNOME?** Enable the "AppIndicator and KStatusNotifierItem
  Support" extension (`gnome-extensions enable
  appindicatorsupport@rgcjonas.gmail.com`).
- **Download feels stuck?** Progress comes from the backend; the toast "… is ready"
  confirms completion. Downloads can be re-run from Settings → Models.
- **Backend logs**: Settings → Backend, or `~/.local/share/whisperglass/sidecar.log`.
  App-side debug logs: Settings → Diagnostics (verbose logging), or
  `~/.local/share/whisperglass/whisperglass.log`.
- **Mic captures silence?** Run the signal test in Settings → Audio — and check the mic
  isn't muted at the OS level (GNOME quick settings / mic-mute key). WhisperGlass
  detects a muted stream and tells you, but the OS mute itself is yours to flip.
- **Reinstall backend**: Settings → Backend → Reinstall (recreates the venv).
- **Idle memory**: models auto-unload from VRAM after 15 min idle (configurable). The
  sidecar keeps up to two models warm (live + final).

## Development

```bash
npm test                          # vitest unit tests (store, WAV, keybinds, stabilizer…)
node scripts/e2e-sidecar.js cpu       # sidecar E2E on CPU
node scripts/e2e-sidecar.js gpu       # sidecar E2E on CUDA
node scripts/e2e-sidecar.js whisperx  # WhisperX + alignment E2E
node scripts/test-download.js     # model download + progress chain
node scripts/test-live.js         # live transcription loop E2E (synthetic speech)
npm start                         # run the app (logs via --enable-logging)
```

Layout: `src/main/*` (Electron main process), `src/components/*` (Lit renderer, zero
build step), `src/utils/mic.js` (AudioWorklet capture), `src/utils/audio-devices.js`
(device ranking), `sidecar/*` (FastAPI backend), `scripts/*` (E2E + diagnostics),
`tests/*` (vitest).

## License

MIT — see [LICENSE](LICENSE).
