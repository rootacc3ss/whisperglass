const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');
const { SidecarManager } = require('../src/main/sidecar');
const { LiveTranscriber } = require('../src/main/live');
const { pcm16ToWavBuffer } = require('../src/main/wav');

const home = os.homedir();
const dataDir = path.join(home, '.local', 'share', 'whisperglass');
const modelsDir = path.join(dataDir, 'models');

const TEXT =
    'The quick brown fox jumps over the lazy dog and then keeps running through the open fields towards the forest';

class FakeRecorder {
    constructor(pcm) {
        this.pcm = pcm;
        this.cursor = 0;
        this._active = true;
    }
    get recording() {
        return this._active;
    }
    hasRecentActivity() {
        return true;
    }
    tailWavBuffer(seconds) {
        this.cursor += 2 * 16000;
        const total = this.pcm.length / 2;
        if (this.cursor > total) this.cursor = total;
        const maxSamples = Math.min(this.cursor, seconds * 16000);
        const start = Math.max(0, this.cursor - maxSamples);
        const slice = this.pcm.subarray(start * 2, this.cursor * 2);
        return { buffer: pcm16ToWavBuffer([slice]), startSec: start / 16000 };
    }
}

function makeSpeechPcm(text) {
    const raw = '/tmp/wg-live-raw.wav';
    const out = '/tmp/wg-live-out.wav';
    execSync(`espeak-ng -w ${JSON.stringify(raw)} ${JSON.stringify(text)}`);
    execSync(`ffmpeg -y -loglevel error -i ${JSON.stringify(raw)} -ar 16000 -ac 1 -sample_fmt s16 ${JSON.stringify(out)}`);
    const wav = fs.readFileSync(out);
    return wav.subarray(44);
}

const waitReady = () =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('ready timeout')), 120000);
        const check = () => {
            if (sidecar.ready) {
                clearTimeout(timer);
                resolve();
            } else setTimeout(check, 500);
        };
        check();
    });

const sidecar = new SidecarManager({
    venvDir: path.join(dataDir, 'venv'),
    modelsDir,
    sidecarDir: path.join(__dirname, '..', 'sidecar'),
    logFile: path.join(dataDir, 'e2e-sidecar.log'),
});

(async () => {
    await sidecar.start();
    await waitReady();
    console.log('sidecar ready, gpu:', sidecar.status.gpu.available);

    const pcm = makeSpeechPcm(TEXT);
    console.log(`speech pcm: ${(pcm.length / 2 / 16000).toFixed(1)}s`);

    const settings = {
        liveTranscription: { enabled: true, model: 'tiny.en' },
        model: 'tiny.en',
        device: 'auto',
        computeType: 'auto',
        language: 'en',
        initialPrompt: '',
    };
    const modelPath = path.join(modelsDir, 'Systran__faster-whisper-tiny.en');

    const partials = [];
    const live = new LiveTranscriber({
        sidecar,
        recorder: new FakeRecorder(pcm),
        audioFile: '/tmp/wg-live-pass.wav',
        getSettings: () => settings,
        getModelDir: () => modelPath,
        onPartial: (p) => {
            partials.push(p);
            console.log(`[pass ${partials.length}] confirmed="${p.confirmed.slice(0, 50)}" partial="${p.partial.slice(0, 40)}"`);
        },
        pollIntervalMs: 120,
    });

    live.start();
    const totalPasses = Math.ceil(pcm.length / 2 / 16000 / 2);
    await new Promise((resolve) => setTimeout(resolve, Math.max(3000, totalPasses * 300 + 4000)));
    await live.stop();

    const last = partials[partials.length - 1] || { confirmed: '', partial: '' };
    const full = `${last.confirmed} ${last.partial}`.toLowerCase();
    const expected = ['quick', 'brown', 'fox', 'jumps', 'lazy', 'dog'];
    const hits = expected.filter((word) => full.includes(word));
    const confirmedGrew = partials.length > 2 && last.confirmed.length > 0;

    console.log(`\npartials: ${partials.length}, confirmed length: ${last.confirmed.length}, word hits: ${hits.length}/${expected.length}`);
    console.log(`final live text: "${full}"`);
    const ok = partials.length >= 3 && confirmedGrew && hits.length >= 3;
    console.log(ok ? 'LIVE E2E PASSED' : 'LIVE E2E FAILED');

    await sidecar.shutdown();
    process.exit(ok ? 0 : 1);
})().catch((err) => {
    console.error('LIVE E2E ERROR:', err);
    process.exit(1);
});
