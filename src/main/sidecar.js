const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hashFile(file) {
    try {
        return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    } catch {
        return 'missing';
    }
}

class SidecarManager extends EventEmitter {
    constructor({ venvDir, modelsDir, sidecarDir, logFile, isVerbose = () => false }) {
        super();
        this.venvDir = venvDir;
        this.modelsDir = modelsDir;
        this.sidecarDir = sidecarDir;
        this.logFile = logFile;
        this.isVerbose = isVerbose;
        this.requirementsHash = hashFile(path.join(sidecarDir, 'requirements.txt'));
        this.child = null;
        this.port = null;
        this._stopped = false;
        this._restarts = 0;
        this._downloads = new Set();
        this._idleTimer = null;
        this._idleMin = 0;
        this.status = {
            phase: 'boot',
            message: 'Starting…',
            detail: '',
            gpu: { available: false, name: '', vramFreeMb: 0 },
            loadedModel: '',
        };
    }

    get pythonBin() {
        return path.join(this.venvDir, 'bin', 'python');
    }

    get ready() {
        return this.status.phase === 'ready' || this.status.phase === 'busy';
    }

    setStatus(phase, message, detail = '') {
        this.status = { ...this.status, phase, message, detail };
        this.emit('status', this.status);
    }

    _log(line) {
        this.emit('log', line);
        try {
            fs.appendFileSync(this.logFile, `${line}\n`);
        } catch {}
    }

    _findUv() {
        if (process.env.WG_UV && fs.existsSync(process.env.WG_UV)) return process.env.WG_UV;
        const candidates = [path.join(os.homedir(), '.local', 'bin', 'uv'), '/usr/local/bin/uv', '/usr/bin/uv'];
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) return candidate;
        }
        return 'uv';
    }

    _run(cmd, args, onLine) {
        return new Promise((resolve, reject) => {
            const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            let pending = '';
            const pump = (data) => {
                pending += data.toString();
                let idx;
                while ((idx = pending.indexOf('\n')) >= 0) {
                    const line = pending.slice(0, idx).trim();
                    pending = pending.slice(idx + 1);
                    if (line && onLine) onLine(line.slice(0, 300));
                }
            };
            child.stdout.on('data', pump);
            child.stderr.on('data', pump);
            child.on('error', reject);
            child.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`${path.basename(cmd)} exited with code ${code}`));
            });
        });
    }

    async _ensureVenv() {
        const uv = this._findUv();
        if (!fs.existsSync(this.pythonBin)) {
            this.setStatus('installing', 'Creating Python 3.12 environment…');
            this.emit('progress', { line: 'uv venv --python 3.12', done: false, error: false });
            await this._run(uv, ['venv', '--python', '3.12', this.venvDir], (line) =>
                this.emit('progress', { line, done: false, error: false })
            );
        }
        const marker = path.join(this.venvDir, '.wg-deps-done');
        let marked = false;
        try {
            marked = fs.readFileSync(marker, 'utf8').trim() === this.requirementsHash;
        } catch {}
        if (marked) return;
        this.setStatus('installing', 'Installing AI packages (one-time, may take a few minutes)…');
        this.emit('progress', { line: 'installing CPU torch…', done: false, error: false });
        await this._run(
            uv,
            [
                'pip', 'install', '--python', this.pythonBin,
                'torch~=2.8.0', 'torchaudio~=2.8.0', 'torchvision~=0.23.0',
                '--index-url', 'https://download.pytorch.org/whl/cpu',
            ],
            (line) => this.emit('progress', { line, done: false, error: false })
        );
        this.emit('progress', { line: 'installing faster-whisper + whisperx…', done: false, error: false });
        await this._run(
            uv,
            ['pip', 'install', '--python', this.pythonBin, '-r', path.join(this.sidecarDir, 'requirements.txt')],
            (line) => this.emit('progress', { line, done: false, error: false })
        );
        try {
            fs.writeFileSync(marker, this.requirementsHash);
        } catch {}
    }

    _findPort() {
        return new Promise((resolve, reject) => {
            const server = net.createServer();
            server.unref();
            server.on('error', reject);
            server.listen(0, '127.0.0.1', () => {
                const port = server.address().port;
                server.close(() => resolve(port));
            });
        });
    }

    _nvidiaLibPaths() {
        const site = path.join(this.venvDir, 'lib', 'python3.12', 'site-packages', 'nvidia');
        return [path.join(site, 'cublas', 'lib'), path.join(site, 'cudnn', 'lib')];
    }

    async _spawn() {
        this.setStatus('starting', 'Starting transcription service…');
        const port = await this._findPort();
        this.port = port;
        const ldParts = [...this._nvidiaLibPaths(), process.env.LD_LIBRARY_PATH || ''].filter(Boolean);
        const verbose = !!this.isVerbose();
        const env = {
            ...process.env,
            LD_LIBRARY_PATH: ldParts.join(':'),
            PYTHONUNBUFFERED: '1',
            HF_HUB_DISABLE_TELEMETRY: '1',
            WG_VERBOSE: verbose ? '1' : '',
        };
        this._log(
            `spawning sidecar: ${this.pythonBin} server.py --port ${port} --models-root ${this.modelsDir}` +
                ` cwd=${this.sidecarDir} verbose=${verbose} ld="${ldParts.join(':')}"`
        );
        this.child = spawn(
            this.pythonBin,
            ['server.py', '--port', String(port), '--models-root', this.modelsDir],
            { cwd: this.sidecarDir, env, stdio: ['ignore', 'pipe', 'pipe'] }
        );
        let pending = '';
        const pump = (data) => {
            pending += data.toString();
            let idx;
            while ((idx = pending.indexOf('\n')) >= 0) {
                const line = pending.slice(0, idx).trim();
                pending = pending.slice(idx + 1);
                if (line) this._log(line.slice(0, 400));
            }
        };
        this.child.stdout.on('data', pump);
        this.child.stderr.on('data', pump);
        this.child.on('exit', (code) => {
            this._log(`sidecar exited (code ${code})`);
            this.child = null;
            this.port = null;
            if (this._stopped) return;
            if (this._restarts >= 3) {
                this.setStatus('error', 'Transcription service keeps crashing', 'Check Settings → Backend logs.');
                return;
            }
            this._restarts += 1;
            this.setStatus('starting', 'Restarting transcription service…');
            setTimeout(() => {
                this._spawn().catch((err) => {
                    this.setStatus('error', 'Failed to start transcription service', String(err.message || err));
                });
            }, 1500 * this._restarts);
        });
        const ok = await this._waitHealth(port, 60000);
        if (!ok) throw new Error('service did not respond to health checks');
        this._restarts = 0;
    }

    async _waitHealth(port, timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline && !this._stopped) {
            try {
                const health = await this._http('GET', '/health', null, 3000, port);
                if (health && health.ok) {
                    this.status = {
                        ...this.status,
                        phase: 'ready',
                        message: '',
                        detail: '',
                        gpu: {
                            available: !!health.gpu_available,
                            name: health.gpu_name || '',
                            vramFreeMb: health.vram_free_mb || 0,
                        },
                        loadedModel: health.loaded_model || '',
                    };
                    this.emit('status', this.status);
                    return true;
                }
            } catch {}
            await sleep(700);
        }
        return false;
    }

    async _http(method, route, body, timeoutMs = 10000, portOverride) {
        const port = portOverride || this.port;
        if (!port) throw new Error('sidecar is not running');
        const res = await fetch(`http://127.0.0.1:${port}${route}`, {
            method,
            headers: body ? { 'content-type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(timeoutMs),
        });
        return res.json();
    }

    async start() {
        this._stopped = false;
        try {
            await this._ensureVenv();
        } catch (err) {
            this._log(`bootstrap failed: ${err.message}`);
            this.emit('progress', { line: String(err.message || err), done: true, error: true });
            this.setStatus('error', 'Backend setup failed', String(err.message || err));
            return;
        }
        try {
            await this._spawn();
        } catch (err) {
            this._log(`spawn failed: ${err.message}`);
            this.setStatus('error', 'Failed to start transcription service', String(err.message || err));
        }
    }

    async refreshHealth() {
        if (!this.ready) return;
        try {
            const health = await this._http('GET', '/health', null, 3000);
            if (health && health.ok) {
                const gpu = {
                    available: !!health.gpu_available,
                    name: health.gpu_name || '',
                    vramFreeMb: health.vram_free_mb || 0,
                };
                const loadedModel = health.loaded_model || '';
                if (loadedModel !== this.status.loadedModel || gpu.available !== this.status.gpu.available) {
                    this.status = { ...this.status, gpu, loadedModel };
                    this.emit('status', this.status);
                }
            }
        } catch {}
    }

    async transcribe(payload, { silent = false } = {}) {
        this._noteActivity();
        if (silent) {
            return this._http('POST', '/transcribe', payload, 600000);
        }
        const previous = this.status.phase;
        this.setStatus('busy', 'Transcribing…');
        try {
            return await this._http('POST', '/transcribe', payload, 600000);
        } finally {
            if (this.status.phase === 'busy') {
                this.setStatus(previous === 'busy' ? 'ready' : previous, '');
            }
        }
    }

    downloadModel(repo) {
        if (!this.ready) {
            this.emit('download', { repo, bytes: 0, total: 0, done: true, error: 'Backend not ready' });
            return;
        }
        if (this._downloads.has(repo)) return;
        this._downloads.add(repo);
        this._http('POST', '/models/download', { repo, root: this.modelsDir }, 1800000).catch((err) => {
            this._log(`download request failed: ${err.message}`);
        });
        const poll = async () => {
            let pending = 0;
            try {
                for (let i = 0; i < 7200; i++) {
                    await sleep(500);
                    if (!this._downloads.has(repo)) return;
                    let progress;
                    try {
                        progress = await this._http('GET', `/models/progress?repo=${encodeURIComponent(repo)}`, null, 5000);
                    } catch {
                        continue;
                    }
                    if (!progress) continue;
                    if (progress.pending) {
                        pending += 1;
                        if (pending > 40) {
                            this.emit('download', { repo, bytes: 0, total: 0, done: true, error: 'Download did not start' });
                            return;
                        }
                        continue;
                    }
                    this.emit('download', { repo, ...progress });
                    if (progress.done) return;
                }
            } finally {
                this._downloads.delete(repo);
            }
        };
        poll();
    }

    async deleteModel(modelDir) {
        return this._http('POST', '/models/delete', { path: modelDir }, 30000);
    }

    async unload() {
        try {
            await this._http('POST', '/unload', {}, 60000);
        } catch {}
        if (this.status.loadedModel !== '') {
            this.status = { ...this.status, loadedModel: '' };
            this.emit('status', this.status);
        }
    }

    armIdle(minutes) {
        this._idleMin = minutes || 0;
        if (this._idleTimer) {
            clearTimeout(this._idleTimer);
            this._idleTimer = null;
        }
        if (this._idleMin > 0) {
            this._idleTimer = setTimeout(() => {
                if (!this._stopped && this.status.phase === 'ready') this.unload();
            }, this._idleMin * 60000);
            this._idleTimer.unref?.();
        }
    }

    _noteActivity() {
        this.armIdle(this._idleMin);
    }

    async shutdown() {
        this._stopped = true;
        this.armIdle(0);
        try {
            await this._http('POST', '/shutdown', {}, 2000);
        } catch {}
        const child = this.child;
        setTimeout(() => {
            if (child && child.exitCode === null) {
                try {
                    child.kill('SIGKILL');
                } catch {}
            }
        }, 2000);
        if (this.child) {
            try {
                this.child.kill('SIGTERM');
            } catch {}
        }
    }
}

module.exports = { SidecarManager };
