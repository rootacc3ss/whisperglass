const fs = require('fs');
const { LiveStabilizer } = require('./stabilizer');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const POLL_INTERVAL_MS = 2000;
const WINDOW_SECONDS = 10;
const ACTIVITY_GATE_MS = 3000;

class LiveTranscriber {
    constructor({ sidecar, recorder, audioFile, getSettings, getModelDir, onPartial, pollIntervalMs = POLL_INTERVAL_MS }) {
        this.sidecar = sidecar;
        this.recorder = recorder;
        this.audioFile = audioFile;
        this.getSettings = getSettings;
        this.getModelDir = getModelDir;
        this.onPartial = onPartial;
        this._pollMs = pollIntervalMs;
        this._running = false;
        this._inflight = null;
        this.stabilizer = new LiveStabilizer();
    }

    get enabled() {
        const s = this.getSettings();
        return !!(s && s.liveTranscription && s.liveTranscription.enabled);
    }

    start() {
        if (this._running) return;
        this._running = true;
        this.stabilizer.reset();
        this.onPartial({ confirmed: '', partial: '' });
        this._loop();
    }

    async stop() {
        this._running = false;
        if (this._inflight) {
            try {
                await this._inflight;
            } catch {}
        }
    }

    async _loop() {
        while (this._running) {
            await sleep(this._pollMs);
            if (!this._running || !this.recorder.recording) continue;
            const s = this.getSettings();
            if (!s || !s.liveTranscription || !s.liveTranscription.enabled) continue;
            if (!this.sidecar.ready) continue;
            const modelKey = s.liveTranscription.model || s.model;
            if (!modelKey) continue;
            const modelPath = this.getModelDir(modelKey);
            if (!modelPath) continue;
            if (!this.recorder.hasRecentActivity(ACTIVITY_GATE_MS)) continue;
            const tail = this.recorder.tailWavBuffer(WINDOW_SECONDS);
            if (!tail) continue;
            try {
                fs.writeFileSync(this.audioFile, tail.buffer);
            } catch {
                continue;
            }
            const payload = {
                wav_path: this.audioFile,
                engine: 'whisper',
                model_path: modelPath,
                device: s.device,
                compute_type: s.computeType,
                language: s.language,
                vad_filter: true,
                initial_prompt: s.initialPrompt || '',
                align: false,
                diarize: false,
                hf_token: '',
            };
            try {
                this._inflight = this.sidecar.transcribe(payload, { silent: true });
                const result = await this._inflight;
                if (
                    this._running &&
                    result &&
                    result.ok &&
                    Array.isArray(result.words) &&
                    result.words.length > 0
                ) {
                    const partial = this.stabilizer.push(result.words, tail.startSec);
                    this.onPartial(partial);
                }
            } catch {}
            this._inflight = null;
        }
    }
}

module.exports = { LiveTranscriber };
