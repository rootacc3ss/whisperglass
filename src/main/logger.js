const fs = require('fs');
const path = require('path');

const MAX_BYTES = 2 * 1024 * 1024;

function ts() {
    const d = new Date();
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

class Logger {
    constructor(file, { isVerbose = () => false } = {}) {
        this.file = file;
        this._isVerbose = isVerbose;
    }

    _write(level, scope, message, data) {
        if (level === 'debug' && !this._isVerbose()) return;
        let line = `[${ts()}] [${level.toUpperCase()}] [${scope}] ${String(message ?? '')}`;
        if (data !== undefined) {
            try {
                let s = JSON.stringify(data);
                if (s && s.length > 2000) s = `${s.slice(0, 2000)}…`;
                line += ` ${s}`;
            } catch {
                line += ' [unserializable]';
            }
        }
        try {
            this._rotateIfNeeded();
            fs.appendFileSync(this.file, `${line}\n`);
        } catch {}
    }

    _rotateIfNeeded() {
        try {
            const st = fs.statSync(this.file);
            if (st.size > MAX_BYTES) {
                const old = `${this.file}.old`;
                try {
                    fs.unlinkSync(old);
                } catch {}
                fs.renameSync(this.file, old);
            }
        } catch {}
    }

    scope(name) {
        const clean = String(name).slice(0, 40);
        return {
            info: (message, data) => this._write('info', clean, message, data),
            debug: (message, data) => this._write('debug', clean, message, data),
            warn: (message, data) => this._write('info', clean, `WARN ${message}`, data),
            error: (message, data) => this._write('info', clean, `ERROR ${message}`, data),
        };
    }

    sessionHeader(extra) {
        const d = new Date().toISOString();
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
        } catch {}
        this._write('info', 'main', `=== WhisperGlass session ${d} ===`, extra);
    }

    tail(lines = 100) {
        try {
            const content = fs.readFileSync(this.file, 'utf8');
            return content.split('\n').filter(Boolean).slice(-lines).join('\n');
        } catch {
            return '';
        }
    }
}

module.exports = { Logger, MAX_BYTES };
