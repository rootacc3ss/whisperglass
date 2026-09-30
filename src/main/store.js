const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const uuid = () => crypto.randomUUID();

const DEFAULT_KEYBINDS = require('./keybinds').DEFAULT_KEYBINDS;

function defaultSettings() {
    return {
        engine: 'whisper',
        device: 'auto',
        model: '',
        computeType: 'auto',
        language: 'auto',
        vadFilter: true,
        initialPrompt: '',
        alignWords: true,
        diarize: false,
        hfToken: '',
        autoCopy: true,
        systemNotifications: true,
        keepAudio: false,
        micDeviceId: '',
        micLabel: '',
        aiAssist: { enabled: false, baseUrl: 'https://api.openai.com/v1', apiKey: '', model: '', autoRefine: false },
        liveTranscription: { enabled: false, model: '' },
        keybinds: { ...DEFAULT_KEYBINDS },
        appearance: {
            transparency: 0.82,
            fontSize: 19,
            compact: false,
            accent: '#007aff',
            sidebarVisible: true,
            showTray: true,
        },
        backend: { nativeWayland: false, idleUnloadMin: 15 },
        debug: { verboseLogging: false },
        hints: { hideToastShown: false },
    };
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, patch) {
    const out = { ...base };
    for (const [key, value] of Object.entries(patch || {})) {
        out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
    }
    return out;
}

class SettingsStore {
    constructor(configDir, fsImpl = fs) {
        this.fs = fsImpl;
        this.file = path.join(configDir, 'settings.json');
        this.data = defaultSettings();
        this.load();
    }

    load() {
        try {
            const raw = this.fs.readFileSync(this.file, 'utf8');
            this.data = deepMerge(defaultSettings(), JSON.parse(raw));
        } catch {
            this.data = defaultSettings();
        }
    }

    get() {
        return this.data;
    }

    patch(partial) {
        this.data = deepMerge(this.data, partial || {});
        this.save();
        return this.data;
    }

    save() {
        try {
            this.fs.mkdirSync(path.dirname(this.file), { recursive: true });
            this.fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
        } catch {}
    }
}

function metaOf(session) {
    return {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        entryCount: session.entries.length,
    };
}

function titleFromText(text, createdAt) {
    const words = String(text || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 7)
        .join(' ');
    if (!words) return `Session ${new Date(createdAt).toLocaleString()}`;
    return words.length > 48 ? `${words.slice(0, 45)}…` : words;
}

class SessionStore {
    constructor(sessionsDir, fsImpl = fs) {
        this.fs = fsImpl;
        this.dir = sessionsDir;
        try {
            this.fs.mkdirSync(this.dir, { recursive: true });
        } catch {}
    }

    _file(id) {
        return path.join(this.dir, `${id}.json`);
    }

    _read(id) {
        try {
            const session = JSON.parse(this.fs.readFileSync(this._file(id), 'utf8'));
            if (!session || !Array.isArray(session.entries) || !session.id) return null;
            return session;
        } catch {
            return null;
        }
    }

    _write(session) {
        this.fs.writeFileSync(this._file(session.id), JSON.stringify(session, null, 2));
    }

    list() {
        let names = [];
        try {
            names = this.fs.readdirSync(this.dir).filter((n) => n.endsWith('.json'));
        } catch {
            return [];
        }
        const sessions = [];
        for (const name of names) {
            const session = this._read(name.slice(0, -5));
            if (session) sessions.push(session);
        }
        sessions.sort((a, b) => b.updatedAt - a.updatedAt);
        return sessions.map(metaOf);
    }

    get(id) {
        return id ? this._read(id) : null;
    }

    create(now = Date.now()) {
        const session = { id: uuid(), title: 'New session', createdAt: now, updatedAt: now, entries: [] };
        this._write(session);
        return session;
    }

    delete(id) {
        try {
            this.fs.unlinkSync(this._file(id));
            return true;
        } catch {
            return false;
        }
    }

    rename(id, title) {
        const session = this._read(id);
        if (!session) return null;
        const clean = String(title || '').trim().slice(0, 80);
        if (clean) session.title = clean;
        session.updatedAt = Date.now();
        this._write(session);
        return session;
    }

    appendEntry(id, entry) {
        const session = this._read(id);
        if (!session) return null;
        session.entries.push(entry);
        session.updatedAt = Date.now();
        if (session.entries.length === 1 && session.title === 'New session' && entry.kind !== 'ai') {
            session.title = titleFromText(entry.text, session.createdAt);
        }
        this._write(session);
        return session;
    }

    // Insert an entry (e.g. an AI output) directly below another entry so
    // chats stay conversational. Falls back to append if the anchor is gone.
    insertEntryAfter(id, afterEntryId, entry) {
        const session = this._read(id);
        if (!session) return null;
        const idx = session.entries.findIndex((e) => e.id === afterEntryId);
        if (idx === -1) session.entries.push(entry);
        else session.entries.splice(idx + 1, 0, entry);
        session.updatedAt = Date.now();
        this._write(session);
        return session;
    }

    updateEntry(id, entryId, text) {
        const session = this._read(id);
        if (!session) return null;
        const entry = session.entries.find((e) => e.id === entryId);
        if (!entry) return null;
        entry.text = String(text ?? entry.text);
        session.updatedAt = Date.now();
        this._write(session);
        return session;
    }

    deleteEntry(id, entryId) {
        const session = this._read(id);
        if (!session) return null;
        session.entries = session.entries.filter((e) => e.id !== entryId);
        session.updatedAt = Date.now();
        this._write(session);
        return session;
    }
}

module.exports = { SettingsStore, SessionStore, defaultSettings, deepMerge, titleFromText, metaOf };
