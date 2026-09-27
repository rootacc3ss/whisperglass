const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pcm16ToWavBuffer } = require('./wav');

const SAMPLE_RATE = 16000;
const MIN_SAMPLES = SAMPLE_RATE * 0.4;
const ACTIVITY_RMS = 0.006;

class Recorder {
    constructor(audioDir) {
        this.audioDir = audioDir;
        this._active = false;
        this._chunks = [];
        this._samples = 0;
        this.startedAt = 0;
        this._lastActiveAt = 0;
    }

    get recording() {
        return this._active;
    }

    start() {
        if (this._active) return false;
        this._active = true;
        this._chunks = [];
        this._samples = 0;
        this.startedAt = Date.now();
        this._lastActiveAt = Date.now();
        return true;
    }

    chunk(buf, rms) {
        if (!this._active || !buf || !buf.length) return;
        this._chunks.push(buf);
        this._samples += buf.length / 2;
        if (typeof rms === 'number' && rms > ACTIVITY_RMS) {
            this._lastActiveAt = Date.now();
        }
    }

    hasRecentActivity(withinMs) {
        return Date.now() - this._lastActiveAt <= withinMs;
    }

    tailWavBuffer(seconds) {
        if (!this._active || this._samples <= 0 || this._chunks.length === 0) return null;
        const need = Math.min(this._samples, Math.round(seconds * SAMPLE_RATE));
        if (need <= 0) return null;
        let remaining = need * 2;
        const parts = [];
        for (let i = this._chunks.length - 1; i >= 0 && remaining > 0; i--) {
            const chunk = this._chunks[i];
            if (chunk.length <= remaining) {
                parts.unshift(chunk);
                remaining -= chunk.length;
            } else {
                parts.unshift(chunk.subarray(chunk.length - remaining));
                remaining = 0;
            }
        }
        const startSec = (this._samples - need) / SAMPLE_RATE;
        return { buffer: pcm16ToWavBuffer(parts), startSec };
    }

    cancel() {
        if (!this._active) return false;
        this._active = false;
        this._chunks = [];
        this._samples = 0;
        return true;
    }

    stop() {
        if (!this._active) return null;
        this._active = false;
        const durationSec = this._samples / SAMPLE_RATE;
        if (this._samples < MIN_SAMPLES) {
            this._chunks = [];
            return { tooShort: true, durationSec };
        }
        const wav = pcm16ToWavBuffer(this._chunks);
        this._chunks = [];
        const file = path.join(this.audioDir, `${crypto.randomUUID()}.wav`);
        try {
            fs.writeFileSync(file, wav);
        } catch (err) {
            return { error: `Failed to write audio file: ${err.message}` };
        }
        return { file, durationSec: Math.round(durationSec * 10) / 10 };
    }
}

module.exports = { Recorder, SAMPLE_RATE };
