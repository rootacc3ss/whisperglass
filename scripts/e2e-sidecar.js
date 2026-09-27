const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');
const { SidecarManager } = require('../src/main/sidecar');

const home = os.homedir();
const dataDir = path.join(home, '.local', 'share', 'whisperglass');
const venvDir = path.join(dataDir, 'venv');
const modelsDir = path.join(dataDir, 'models');
const sidecarDir = path.join(__dirname, '..', 'sidecar');
fs.mkdirSync(modelsDir, { recursive: true });

const sidecar = new SidecarManager({
    venvDir,
    modelsDir,
    sidecarDir,
    logFile: path.join(dataDir, 'e2e-sidecar.log'),
});

const waitReady = (timeoutMs) =>
    new Promise((resolve, reject) => {
        const started = Date.now();
        const timer = setTimeout(() => reject(new Error('timeout waiting for ready')), timeoutMs);
        const check = () => {
            if (sidecar.ready) {
                clearTimeout(timer);
                resolve();
            } else if (sidecar.status.phase === 'error' && Date.now() - started > 60000) {
                clearTimeout(timer);
                reject(new Error(`sidecar error: ${sidecar.status.message} ${sidecar.status.detail}`));
            } else setTimeout(check, 1000);
        };
        check();
    });

const waitDownload = (repo, timeoutMs) =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`download timeout: ${repo}`)), timeoutMs);
        const onDownload = (d) => {
            if (d.repo !== repo) return;
            if (d.done) {
                clearTimeout(timer);
                sidecar.removeListener('download', onDownload);
                if (d.error) reject(new Error(`download failed: ${d.error}`));
                else resolve();
            }
        };
        sidecar.on('download', onDownload);
    });

function makeSpeechWav(text, outFile) {
    const raw = outFile.replace(/\.wav$/, '.raw.wav');
    execSync(`espeak-ng -w ${JSON.stringify(raw)} ${JSON.stringify(text)}`);
    execSync(`ffmpeg -y -loglevel error -i ${JSON.stringify(raw)} -ar 16000 -ac 1 -sample_fmt s16 ${JSON.stringify(outFile)}`);
    fs.unlinkSync(raw);
    return outFile;
}

async function main() {
    const mode = process.argv[2] || 'cpu';
    const t0 = Date.now();
    sidecar.on('progress', (p) => console.log(`[setup] ${p.line}`));
    sidecar.on('status', (s) => console.log(`[status] ${s.phase}${s.message ? `: ${s.message}` : ''}`));
    sidecar.on('log', (l) => console.log(`[sidecar] ${l}`));

    await sidecar.start();
    await waitReady(45 * 60000);
    console.log(`\n== READY in ${((Date.now() - t0) / 1000).toFixed(0)}s; gpu=${JSON.stringify(sidecar.status.gpu)}\n`);

    const repo = 'Systran/faster-whisper-tiny.en';
    const modelPath = path.join(modelsDir, 'Systran__faster-whisper-tiny.en');
    if (!fs.existsSync(path.join(modelPath, 'model.bin'))) {
        console.log('downloading tiny.en…');
        const done = waitDownload(repo, 20 * 60000);
        sidecar.downloadModel(repo);
        await done;
        console.log('tiny.en downloaded.');
    } else {
        console.log('tiny.en already present.');
    }

    const wav = makeSpeechWav(
        'This is a Whisper Glass end to end test of the speech to text pipeline.',
        '/tmp/wg-e2e-speech.wav'
    );

    const payload = {
        wav_path: wav,
        engine: mode === 'whisperx' ? 'whisperx' : 'whisper',
        model_path: modelPath,
        device: mode === 'cpu' ? 'cpu' : 'cuda',
        compute_type: 'auto',
        language: 'en',
        vad_filter: false,
        initial_prompt: '',
        align: mode === 'whisperx',
        diarize: false,
        hf_token: '',
    };

    console.log(`\n== TRANSCRIBE (${mode}) ==`);
    const result = await sidecar.transcribe(payload);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
        console.error('E2E FAILED');
        process.exitCode = 1;
    } else {
        console.log('\nE2E PASSED');
    }

    if (mode === 'gpu' && result.ok && result.device !== 'cuda') {
        console.error(`EXPECTED cuda but ran on ${result.device} — ${result.fallback_reason || 'no fallback reason'}`);
        process.exitCode = 1;
    }

    await sidecar.shutdown();
    process.exit(process.exitCode || 0);
}

main().catch((err) => {
    console.error('E2E ERROR:', err);
    process.exit(1);
});
