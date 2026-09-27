const path = require('path');
const os = require('os');
const fs = require('fs');
const { SidecarManager } = require('../src/main/sidecar');

const home = os.homedir();
const dataDir = path.join(home, '.local', 'share', 'whisperglass');

const sidecar = new SidecarManager({
    venvDir: path.join(dataDir, 'venv'),
    modelsDir: path.join(dataDir, 'models'),
    sidecarDir: path.join(__dirname, '..', 'sidecar'),
    logFile: path.join(dataDir, 'e2e-sidecar.log'),
});

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

(async () => {
    await sidecar.start();
    await waitReady();
    console.log('READY, starting base.en download via downloadModel()…');

    const repo = 'Systran/faster-whisper-base.en';
    const dir = path.join(dataDir, 'models', 'Systran__faster-whisper-base.en');
    fs.rmSync(dir, { recursive: true, force: true });

    let events = 0;
    let last = null;
    sidecar.on('download', (d) => {
        events += 1;
        last = d;
        const pct = d.total ? Math.round((d.bytes / d.total) * 100) : 0;
        process.stdout.write(`\r[download] event#${events} ${pct}% done=${d.done} error=${d.error || '-'} pending=${!!d.pending}   `);
    });

    await new Promise((resolve) => {
        const onDone = (d) => {
            if (d.repo !== repo || !d.done) return;
            sidecar.removeListener('download', onDone);
            resolve();
        };
        sidecar.on('download', onDone);
        sidecar.downloadModel(repo);
    });

    console.log(`\nfinished: ${JSON.stringify({ events, done: last?.done, error: last?.error })}`);
    const ok = events > 2 && last?.done && !last?.error && fs.existsSync(path.join(dir, 'model.bin'));
    console.log(ok ? 'DOWNLOAD CHAIN PASSED' : 'DOWNLOAD CHAIN FAILED');
    await sidecar.shutdown();
    process.exit(ok ? 0 : 1);
})().catch((err) => {
    console.error('TEST ERROR:', err);
    process.exit(1);
});
