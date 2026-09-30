const { app, ipcMain, clipboard, Notification, shell, dialog, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');

const earlySettings = (() => {
    try {
        return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'whisperglass', 'settings.json'), 'utf8'));
    } catch {
        return {};
    }
})();

// Electron selects the ozone platform before main runs, so appendSwitch is too late —
// relaunch once with the flag instead (guarded, no loop possible).
const wantsX11 =
    process.env.XDG_SESSION_TYPE === 'wayland' &&
    !(earlySettings.backend && earlySettings.backend.nativeWayland) &&
    !process.argv.includes('--ozone-platform=x11');
if (wantsX11) {
    app.relaunch({ args: [...process.argv.slice(1), '--ozone-platform=x11'] });
    app.exit(0);
}

const { getPaths, ensureDirs } = require('./main/paths');
const { SettingsStore, SessionStore } = require('./main/store');
const { createMainWindow } = require('./main/window');
const { KeybindManager } = require('./main/keybinds');
const { Recorder } = require('./main/recorder');
const { LiveTranscriber } = require('./main/live');
const { SidecarManager } = require('./main/sidecar');
const { Logger } = require('./main/logger');
const { createTray } = require('./main/tray');
const { StatusWindow } = require('./main/status-window');
const ai = require('./main/ai');
const gnomeKeybind = require('./main/gnome-keybind');

// wg-audio:///<sessionId>/<file> serves archived session audio to the
// renderer's <audio> player without opening the fs to the web layer.
protocol.registerSchemesAsPrivileged([
    { scheme: 'wg-audio', privileges: { bypassCSP: false, stream: true, supportFetchAPI: true } },
]);

const CLI_COMMANDS = ['--toggle', '--show', '--hide', '--record'];

const CATALOG = [
    { key: 'tiny.en', name: 'Tiny (English)', repo: 'Systran/faster-whisper-tiny.en', sizeMb: 75, multilingual: false },
    { key: 'base.en', name: 'Base (English)', repo: 'Systran/faster-whisper-base.en', sizeMb: 145, multilingual: false },
    { key: 'small.en', name: 'Small (English)', repo: 'Systran/faster-whisper-small.en', sizeMb: 485, multilingual: false },
    { key: 'small', name: 'Small (Multilingual)', repo: 'Systran/faster-whisper-small', sizeMb: 485, multilingual: true },
    { key: 'medium.en', name: 'Medium (English)', repo: 'Systran/faster-whisper-medium.en', sizeMb: 1500, multilingual: false },
    { key: 'medium', name: 'Medium (Multilingual)', repo: 'Systran/faster-whisper-medium', sizeMb: 1500, multilingual: true },
    { key: 'turbo', name: 'Turbo (large-v3-turbo)', repo: 'deepdml/faster-whisper-large-v3-turbo-ct2', sizeMb: 1600, multilingual: true },
    { key: 'distil-large-v3', name: 'Distil Large v3', repo: 'Systran/faster-distil-whisper-large-v3', sizeMb: 1500, multilingual: false },
    { key: 'large-v3', name: 'Large v3', repo: 'Systran/faster-whisper-large-v3', sizeMb: 3100, multilingual: true },
];

const REPO_TO_KEY = Object.fromEntries(CATALOG.map((m) => [m.repo, m.key]));

function safeRepoDir(repo) {
    let name = String(repo).trim().replace(/^\/+|\/+$/g, '').replace(/\//g, '__');
    return name.replace(/[^A-Za-z0-9._-]+/g, '_') || 'model';
}

function dirSizeBytes(dir) {
    let total = 0;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === '.cache' || entry.name === '.locks') continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) total += dirSizeBytes(full);
            else if (entry.isFile()) total += fs.statSync(full).size;
        }
    } catch {}
    return total;
}

let win = null;
let settingsStore = null;
let sessionStore = null;
let sidecar = null;
let recorder = null;
let keybinds = null;
let trayHandle = null;
let statusWin = null;
let live = null;
let logger = null;
let keybindInfo = { gnome: false, bindings: {}, conflicts: [], error: '' };
let activeSessionId = null;
let onboarded = false;
let catalog = [];
let recordCapTimer = null;
let healthTimer = null;
let chunkLogCounter = 0;
let paths = null;

function readAppState() {
    try {
        return JSON.parse(fs.readFileSync(paths.appStateFile, 'utf8'));
    } catch {
        return {};
    }
}

function writeAppState() {
    try {
        fs.mkdirSync(path.dirname(paths.appStateFile), { recursive: true });
        fs.writeFileSync(paths.appStateFile, JSON.stringify({ activeSessionId }));
    } catch {}
}

function scanCatalog() {
    catalog = CATALOG.map((entry) => {
        const dir = path.join(paths.modelsDir, safeRepoDir(entry.repo));
        const downloaded = fs.existsSync(path.join(dir, 'model.bin'));
        const onDiskMb = downloaded ? Math.round(dirSizeBytes(dir) / 1048576) : 0;
        return { ...entry, downloaded, onDiskMb };
    });
}

function modelDirFor(key) {
    const entry = CATALOG.find((m) => m.key === key);
    return entry ? path.join(paths.modelsDir, safeRepoDir(entry.repo)) : null;
}

function buildState() {
    const settings = settingsStore.get();
    return {
        settings,
        sessions: sessionStore.list(),
        activeSessionId,
        activeSession: sessionStore.get(activeSessionId),
        status: sidecar ? sidecar.status : { phase: 'boot', message: '', detail: '', gpu: { available: false, name: '', vramFreeMb: 0 }, loadedModel: '' },
        keybinds: settings.keybinds,
        keybindInfo,
        catalog,
        onboarded,
    };
}

function broadcast(channel, payload) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function broadcastState() {
    broadcast('wg:state', buildState());
}

function log(scope) {
    return logger ? logger.scope(scope) : { info() {}, debug() {}, warn() {}, error() {} };
}

async function askRestartForLogging(verboseOn) {
    const message = verboseOn
        ? 'Restart WhisperGlass now to turn verbose logging on?'
        : 'Restart WhisperGlass now to turn verbose logging off?';
    const result = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        message,
        detail: 'The change applies from the next launch.',
    });
    if (result.response === 0) {
        log('main').info('restarting for logging change', { verboseOn });
        app.relaunch({ args: process.argv.slice(1) });
        app.exit(0);
    }
}

function showWindow() {
    if (win && !win.isDestroyed() && !win.isVisible()) win.showInactive();
}

function hideWindow() {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    win.hide();
    const s = settingsStore.get();
    if (s.hints && !s.hints.hideToastShown) {
        const restore = s.keybinds.systemKeybind ? 'your system keybind' : s.keybinds.toggleVisibility;
        notify(`Hidden — restore from the tray or with ${restore}`);
        settingsStore.patch({ hints: { hideToastShown: true } });
    }
}

function toggleWindow() {
    if (!win || win.isDestroyed()) return;
    if (win.isVisible()) hideWindow();
    else win.showInactive();
}

function handleCliCommand(cmd) {
    if (cmd === '--show') showWindow();
    else if (cmd === '--hide') hideWindow();
    else if (cmd === '--toggle') toggleWindow();
    else if (cmd === '--record') {
        if (!onboarded) return;
        if (recorder.recording) stopRecordingFlow();
        else startRecordingFlow();
    }
}

function applyKeybinds() {
    const s = settingsStore.get();
    const map = { ...s.keybinds };
    if (map.systemKeybind) delete map.toggleVisibility;
    if (map.systemRecord) delete map.toggleRecording;
    keybinds.register(map);
}

function updateTray() {
    const show = settingsStore.get().appearance.showTray;
    if (show && !trayHandle) {
        trayHandle = createTray({
            onShow: () => showWindow(),
            onToggleRecording: () => {
                if (!onboarded) return;
                if (recorder.recording) stopRecordingFlow();
                else startRecordingFlow();
            },
            onNewSession: () => {
                const session = sessionStore.create();
                activeSessionId = session.id;
                writeAppState();
                broadcastState();
                showWindow();
            },
            onSettings: () => {
                broadcast('wg:open-settings');
                showWindow();
            },
            onQuit: () => app.quit(),
        });
    } else if (!show && trayHandle) {
        trayHandle.destroy();
        trayHandle = null;
    }
}

async function refreshKeybindInfo() {
    try {
        keybindInfo = await gnomeKeybind.status();
    } catch {
        keybindInfo = { gnome: false, bindings: {}, conflicts: [], error: '' };
    }
    if (keybindInfo.conflicts && keybindInfo.conflicts.length) {
        log('keybinds').warn(
            `system keybind conflict: ${keybindInfo.conflicts
                .map((c) => `${c.name || c.dir} shadows ${c.binding}`)
                .join('; ')}`
        );
    }
    broadcastState();
}

function ensureActiveSession() {
    let session = sessionStore.get(activeSessionId);
    if (!session) {
        const metas = sessionStore.list();
        session = metas.length ? sessionStore.get(metas[0].id) : sessionStore.create();
        activeSessionId = session.id;
        writeAppState();
    }
    return session;
}

function notify(body) {
    const settings = settingsStore.get();
    if (settings.systemNotifications && Notification.isSupported()) {
        try {
            new Notification({ title: 'WhisperGlass', body }).show();
        } catch {}
    }
}

async function transcribeFlow(file, durationSec) {
    if (!sidecar.ready) {
        broadcast('wg:transcribe:error', { message: 'Backend is not ready yet.', kind: 'internal' });
        if (statusWin) statusWin.update('error', { text: 'Backend not ready' }, { dismissMs: 3000 });
        try {
            fs.unlinkSync(file);
        } catch {}
        return;
    }
    const s = settingsStore.get();
    const engine = s.engine === 'whisperx' ? 'whisperx' : 'whisper';
    const modelDir = modelDirFor(s.model);
    const payload = {
        wav_path: file,
        engine,
        model_path: modelDir || '',
        device: s.device,
        compute_type: s.computeType,
        language: s.language,
        vad_filter: !!s.vadFilter,
        initial_prompt: s.initialPrompt || '',
        align: engine === 'whisperx' && !!s.alignWords,
        diarize: engine === 'whisperx' && !!s.diarize,
        hf_token: s.hfToken || '',
    };
    let result;
    try {
        log('asr').debug('transcribe request', {
            file,
            engine,
            model: s.model,
            device: s.device,
            language: s.language,
            durationSec,
        });
        result = await sidecar.transcribe(payload);
    } catch (err) {
        broadcast('wg:transcribe:error', { message: String(err.message || err), kind: 'internal' });
        result = null;
    }
    if (!result) {
        try {
            fs.unlinkSync(file);
        } catch {}
        if (statusWin) statusWin.update('error', { text: 'Transcription failed' }, { dismissMs: 3000 });
        return;
    }
    log('asr').info('transcribe result', {
        ok: result.ok,
        kind: result.kind,
        textLength: (result.text || '').length,
        words: (result.words || []).length,
        language: result.language,
        elapsed: result.elapsed,
        device: result.device,
        fallbackReason: result.fallback_reason,
    });
    if (!result.ok) {
        broadcast('wg:transcribe:error', { message: result.error || 'Transcription failed.', kind: result.kind || 'internal' });
        if (result.fallback_reason) broadcast('wg:transcribe:error', { message: result.fallback_reason, kind: 'info' });
        try {
            fs.unlinkSync(file);
        } catch {}
        if (statusWin) statusWin.update('error', { text: result.error || 'Transcription failed' }, { dismissMs: 3200 });
        return;
    }

    const session = ensureActiveSession();
    const entry = {
        id: require('node:crypto').randomUUID(),
        text: result.text || '',
        createdAt: Date.now(),
        durationSec: Math.round((durationSec || 0) * 10) / 10,
        language: result.language || '',
        engine,
        model: s.model,
        device: result.device || s.device,
        elapsedSec: result.elapsed || 0,
        words: result.words || [],
    };
    if (result.speakers && result.speakers.length) entry.speakers = result.speakers;

    // keepAudio: archive the WAV next to the session and link it to the entry
    if (s.keepAudio) {
        try {
            const sessAudioDir = path.join(paths.audioDir, session.id);
            fs.mkdirSync(sessAudioDir, { recursive: true });
            const dest = path.join(sessAudioDir, `${entry.id}.wav`);
            fs.renameSync(file, dest);
            entry.audioFile = `${session.id}/${entry.id}.wav`;
            log('rec').info('audio archived', { file: entry.audioFile, bytes: fs.statSync(dest).size });
        } catch (err) {
            log('rec').warn('audio archive failed', { error: String(err.message || err) });
            try {
                fs.unlinkSync(file);
            } catch {}
        }
    }

    const updated = sessionStore.appendEntry(session.id, entry);

    let copied = false;
    if (s.autoCopy && entry.text) {
        clipboard.writeText(entry.text);
        copied = true;
        notify('Transcription copied to clipboard.');
    }
    if (!s.keepAudio && !entry.audioFile) {
        try {
            fs.unlinkSync(file);
        } catch {}
    }
    activeSessionId = session.id;
    writeAppState();
    broadcastState();
    broadcast('wg:transcribe:result', { session: updated, entry, copied });
    if (s.aiAssist && s.aiAssist.enabled && s.aiAssist.autoRefine && entry.text.trim()) {
        log('ai').info('auto-refine triggered');
        runAi('improve', session.id, entry.id).catch(() => {});
    }
    if (statusWin) {
        statusWin.update('done', { copied, text: entry.text.trim() ? '' : 'No speech detected' }, { dismissMs: 2800 });
    }
    if (!entry.text.trim() && durationSec > 2) {
        log('asr').info('no speech detected', { durationSec, device: entry.device });
        broadcast('wg:transcribe:error', {
            message: 'No speech detected — try the signal test in Settings → Audio',
            kind: 'no_speech',
        });
    }
}

function stopRecordingFlow() {
    const result = recorder.stop();
    if (recordCapTimer) {
        clearTimeout(recordCapTimer);
        recordCapTimer = null;
    }
    log('rec').info('stop recording', {
        ok: !!result,
        tooShort: !!result?.tooShort,
        durationSec: result?.durationSec,
        file: result?.file,
        error: result?.error,
    });
    broadcast('wg:rec-stopped');
    if (!result) return { ok: false, error: 'Not recording' };
    const finish = async () => {
        if (live) await live.stop();
        if (result.tooShort) {
            broadcast('wg:transcribe:error', {
                message: 'Recording too short — hold the key a moment longer.',
                kind: 'no_speech',
            });
            if (statusWin) statusWin.update('error', { text: 'Too short' }, { dismissMs: 2600 });
            return;
        }
        if (result.error) {
            broadcast('wg:transcribe:error', { message: result.error, kind: 'internal' });
            if (statusWin) statusWin.update('error', { text: 'Recording failed' }, { dismissMs: 3000 });
            return;
        }
        const s = settingsStore.get();
        if (statusWin) statusWin.update('transcribing', { model: s.model });
        await transcribeFlow(result.file, result.durationSec);
    };
    finish();
    return { ok: true };
}

function startRecordingFlow() {
    if (!onboarded) return { ok: false, error: 'Finish setup first' };
    if (recorder.recording) return { ok: false, error: 'Already recording' };
    recorder.start();
    if (live) live.start();
    chunkLogCounter = 0;
    log('rec').info('start recording', { liveEnabled: live?.enabled });
    broadcast('wg:rec-started');
    if (statusWin) statusWin.show('recording', {}, { dismissMs: 30 * 60000 });
    if (recordCapTimer) clearTimeout(recordCapTimer);
    recordCapTimer = setTimeout(() => {
        if (recorder.recording) stopRecordingFlow();
    }, 30 * 60000);
    return { ok: true };
}

async function runAi(action, sessionId, entryId, prompt) {
    const settings = settingsStore.get();
    const a = settings.aiAssist || {};
    if (!a.enabled) return { ok: false, error: 'AI assist is off (Settings → AI Assist)' };
    const session = sessionStore.get(sessionId);
    if (!session) return { ok: false, error: 'Session not found' };
    const source = (session.entries || []).find((e) => e.id === entryId);
    if (!source) return { ok: false, error: 'Source entry not found' };
    let messages;
    try {
        messages = ai.buildMessages(session.entries || [], entryId, action, prompt);
    } catch (err) {
        return { ok: false, error: String(err.message || err) };
    }
    const label = action === 'improve' ? 'improved' : action === 'summarize' ? 'summarized' : 'custom';
    log('ai').info('ai run', { action, model: a.model, sourceChars: (source.text || '').length, sessionId });
    try {
        const text = await ai.runCompletion(a, messages);
        const entry = {
            id: require('node:crypto').randomUUID(),
            kind: 'ai',
            aiAction: label,
            sourceEntryId: entryId,
            text,
            createdAt: Date.now(),
            model: a.model,
        };
        const updated = sessionStore.insertEntryAfter(sessionId, entryId, entry);
        activeSessionId = sessionId;
        writeAppState();
        broadcastState();
        broadcast('wg:transcribe:result', { session: updated, entry, copied: false });
        log('ai').info('ai result', { action, chars: text.length });
        return { ok: true, entry };
    } catch (err) {
        log('ai').warn('ai failed', { action, error: String(err.message || err).slice(0, 300) });
        return { ok: false, error: String(err.message || err) };
    }
}

function registerIpc() {
    ipcMain.handle('wg:state:get', () => buildState());

    ipcMain.handle('wg:settings:set', (_e, patch) => {
        const prev = settingsStore.get();
        const settings = settingsStore.patch(patch);
        if (patch && patch.keybinds) applyKeybinds();
        if (patch && patch.appearance && patch.appearance.showTray !== prev.appearance.showTray) updateTray();
        if (patch && patch.backend && patch.backend.idleUnloadMin !== prev.backend.idleUnloadMin) {
            sidecar.armIdle(settings.backend.idleUnloadMin);
        }
        if (patch && patch.debug && patch.debug.verboseLogging !== undefined) {
            log('main').info('verbose logging setting changed', {
                from: prev.debug.verboseLogging,
                to: patch.debug.verboseLogging,
            });
            broadcastState();
            if (win && !win.isDestroyed()) {
                askRestartForLogging(!!patch.debug.verboseLogging);
            }
            return settings;
        }
        if (patch && patch.micDeviceId !== undefined) {
            log('main').info('microphone selection changed', {
                micDeviceId: patch.micDeviceId,
            });
        }
        broadcastState();
        return settings;
    });

    ipcMain.on('wg:debug:log', (_e, p) => {
        if (!p || !logger) return;
        const scope = logger.scope(String(p.scope || 'renderer'));
        const fn = p.level === 'info' ? 'info' : 'debug';
        try {
            scope[fn](String(p.message || '').slice(0, 600), p.data);
        } catch {}
    });

    ipcMain.handle('wg:debug:read-log', () => ({ log: logger ? logger.tail(150) : '' }));

    ipcMain.handle('wg:debug:open-log', () => {
        if (paths) shell.openPath(paths.appLog);
        return { ok: true };
    });

    ipcMain.handle('wg:keybinds:set', (_e, map) => {
        const settings = settingsStore.patch({ keybinds: map });
        applyKeybinds();
        broadcastState();
        return settings.keybinds;
    });

    ipcMain.handle('wg:keybinds:install-system', async (_e, { action, combo }) => {
        const which = action === 'record' ? 'record' : 'toggle';
        try {
            await gnomeKeybind.install({
                action: which,
                combo: combo || (which === 'record' ? 'Alt+Shift+R' : 'Alt+Shift+W'),
                execPath: process.execPath,
                appPath: app.getAppPath(),
                packaged: app.isPackaged,
            });
            settingsStore.patch({ keybinds: { [which === 'record' ? 'systemRecord' : 'systemKeybind']: true } });
            applyKeybinds();
            await refreshKeybindInfo();
            return { ok: true };
        } catch (err) {
            return { ok: false, error: String(err.message || err) };
        }
    });

    ipcMain.handle('wg:keybinds:uninstall-system', async (_e, { action } = {}) => {
        const which = action === 'record' ? 'record' : action === 'toggle' ? 'toggle' : null;
        try {
            await gnomeKeybind.uninstall(which || undefined);
        } catch {}
        if (which) settingsStore.patch({ keybinds: { [which === 'record' ? 'systemRecord' : 'systemKeybind']: false } });
        else settingsStore.patch({ keybinds: { systemKeybind: false, systemRecord: false } });
        applyKeybinds();
        await refreshKeybindInfo();
        return { ok: true };
    });

    ipcMain.handle('wg:ai:run', (_e, p) => runAi(p?.action, p?.sessionId, p?.entryId, p?.prompt));

    ipcMain.handle('wg:ai:test', async () => {
        const a = settingsStore.get().aiAssist || {};
        try {
            await ai.testConnection(a);
            return { ok: true };
        } catch (err) {
            return { ok: false, error: String(err.message || err) };
        }
    });

    ipcMain.handle('wg:session:new', () => {
        const session = sessionStore.create();
        activeSessionId = session.id;
        writeAppState();
        broadcastState();
        return session;
    });

    ipcMain.handle('wg:session:open', (_e, { id }) => {
        const session = sessionStore.get(id);
        if (!session) return null;
        activeSessionId = id;
        writeAppState();
        broadcastState();
        return session;
    });

    ipcMain.handle('wg:session:delete', (_e, { id }) => {
        sessionStore.delete(id);
        try {
            const sessAudioDir = path.join(paths.audioDir, id);
            if (fs.existsSync(sessAudioDir)) fs.rmSync(sessAudioDir, { recursive: true, force: true });
        } catch {}
        if (activeSessionId === id) {
            const metas = sessionStore.list();
            activeSessionId = metas.length ? metas[0].id : null;
            writeAppState();
        }
        broadcastState();
        return { ok: true, activeSessionId };
    });

    ipcMain.handle('wg:session:rename', (_e, { id, title }) => {
        const session = sessionStore.rename(id, title);
        broadcastState();
        return session;
    });

    ipcMain.handle('wg:session:entry:update', (_e, { sessionId, entryId, text }) => {
        const session = sessionStore.updateEntry(sessionId, entryId, text);
        broadcastState();
        return session;
    });

    ipcMain.handle('wg:session:entry:delete', (_e, { sessionId, entryId }) => {
        const session = sessionStore.get(sessionId);
        const entry = session && (session.entries || []).find((e) => e.id === entryId);
        if (entry && entry.audioFile) {
            try {
                fs.unlinkSync(path.join(paths.audioDir, entry.audioFile));
            } catch {}
        }
        const updated = sessionStore.deleteEntry(sessionId, entryId);
        broadcastState();
        return updated;
    });

    ipcMain.handle('wg:rec:start', () => startRecordingFlow());
    ipcMain.handle('wg:rec:stop', () => stopRecordingFlow());
    ipcMain.handle('wg:rec:cancel', () => {
        if (recordCapTimer) {
            clearTimeout(recordCapTimer);
            recordCapTimer = null;
        }
        recorder.cancel();
        if (live) live.stop();
        if (statusWin) statusWin.hide();
        broadcast('wg:rec-cancelled');
        return { ok: true };
    });

    ipcMain.on('wg:rec-chunk', (_e, payload) => {
        if (!payload || !payload.buffer) return;
        recorder.chunk(Buffer.from(payload.buffer), payload.rms);
        if (log('rec').debug && chunkLogCounter < 20) {
            log('rec').debug('chunk received', { n: chunkLogCounter, bytes: payload.buffer.byteLength, rms: payload.rms });
        }
        chunkLogCounter += 1;
        if (chunkLogCounter % 25 === 0) {
            log('rec').debug('chunk heartbeat', { n: chunkLogCounter, totalSamples: recorder._samples, rms: payload.rms });
        }
    });

    ipcMain.handle('wg:models:download', (_e, { key }) => {
        const entry = CATALOG.find((m) => m.key === key);
        if (!entry) return { ok: false, error: 'Unknown model' };
        sidecar.downloadModel(entry.repo);
        return { ok: true };
    });

    ipcMain.handle('wg:models:delete', async (_e, { key }) => {
        const dir = modelDirFor(key);
        if (!dir) return { ok: false, error: 'Unknown model' };
        try {
            await sidecar.deleteModel(dir);
        } catch {}
        scanCatalog();
        broadcastState();
        return { ok: true };
    });

    ipcMain.handle('wg:backend:retry', () => {
        sidecar.start();
        return { ok: true };
    });

    ipcMain.handle('wg:window:toggle-sidebar', () => {
        const settings = settingsStore.get();
        const settings2 = settingsStore.patch({
            appearance: { sidebarVisible: !settings.appearance.sidebarVisible },
        });
        return settings2;
    });

    ipcMain.handle('wg:app:finish-onboarding', () => {
        try {
            fs.writeFileSync(paths.onboardedMarker, String(Date.now()));
        } catch {}
        onboarded = true;
        ensureActiveSession();
        broadcastState();
        return { ok: true };
    });

    ipcMain.handle('wg:clipboard:copy', (_e, { text }) => {
        clipboard.writeText(String(text || ''));
        return { ok: true };
    });

    ipcMain.handle('wg:open-external', (_e, { url }) => {
        if (/^https:\/\//.test(url || '')) shell.openExternal(url);
        return { ok: true };
    });

    ipcMain.handle('wg:app:quit', () => {
        app.quit();
        return { ok: true };
    });

    ipcMain.on('wg:window-hide', () => {
        hideWindow();
    });

    ipcMain.on('wg:window-move', (_e, { dx, dy }) => {
        if (!win || win.isDestroyed()) return;
        const [x, y] = win.getPosition();
        win.setPosition(x + (dx || 0), y + (dy || 0));
        win.emit('moved');
    });
}

function setupActions() {
    return {
        toggleVisibility: () => toggleWindow(),
        toggleRecording: () => {
            if (!onboarded) return;
            if (recorder.recording) stopRecordingFlow();
            else startRecordingFlow();
        },
        newSession: () => {
            if (!onboarded) return;
            const session = sessionStore.create();
            activeSessionId = session.id;
            writeAppState();
            broadcastState();
            showWindow();
        },
        toggleSidebar: () => {
            const settings = settingsStore.get();
            settingsStore.patch({ appearance: { sidebarVisible: !settings.appearance.sidebarVisible } });
            broadcastState();
        },
        moveUp: () => {},
        moveDown: () => {},
        moveLeft: () => {},
        moveRight: () => {},
    };
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.exit(0);
} else {
    app.on('second-instance', (_e, commandLine) => {
        const cmd = CLI_COMMANDS.find((c) => commandLine.includes(c));
        log('main').info('second-instance command', { cmd: cmd || '(show)', argv: commandLine.slice(0, 8) });
        if (cmd) {
            handleCliCommand(cmd);
            return;
        }
        showWindow();
    });

    app.whenReady().then(() => {
        paths = getPaths();
        ensureDirs(paths);

        protocol.handle('wg-audio', (request) => {
            const rel = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''));
            const clean = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
            const file = path.join(paths.audioDir, clean);
            if (!file.startsWith(paths.audioDir)) return new Response('Not found', { status: 404 });
            return net.fetch(pathToFileURL(file).toString());
        });

        settingsStore = new SettingsStore(paths.configDir);
        sessionStore = new SessionStore(paths.sessionsDir);
        onboarded = fs.existsSync(paths.onboardedMarker);
        activeSessionId = readAppState().activeSessionId || null;
        if (activeSessionId && !sessionStore.get(activeSessionId)) activeSessionId = null;

        logger = new Logger(paths.appLog, { isVerbose: () => !!settingsStore.get().debug?.verboseLogging });
        logger.sessionHeader({
            pid: process.pid,
            argv: process.argv,
            verbose: !!settingsStore.get().debug?.verboseLogging,
            electron: process.versions.electron,
        });
        log('main').info('session started', { onboarded, activeSessionId });

        scanCatalog();
        win = createMainWindow(paths, { onboarded });

        win.webContents.on('console-message', (_e, _level, message, line, sourceId) => {
            if (message) log('renderer').debug(`${String(message).slice(0, 400)} (${String(sourceId || '').split('/').pop()}:${line})`);
        });

        sidecar = new SidecarManager({
            venvDir: paths.venvDir,
            modelsDir: paths.modelsDir,
            sidecarDir: paths.sidecarDir,
            logFile: paths.sidecarLog,
            isVerbose: () => !!settingsStore.get().debug?.verboseLogging,
        });
        sidecar.on('status', (status) => {
            log('sidecar').debug('status', { phase: status.phase, message: status.message });
            broadcast('wg:status', status);
        });
        sidecar.on('progress', (p) => {
            log('sidecar').debug('bootstrap progress', { line: p.line, done: p.done, error: p.error });
            broadcast('wg:backend-progress', p);
        });
        sidecar.on('log', (l) => log('sidecar').debug(l));
        sidecar.on('download', (d) => {
            const key = REPO_TO_KEY[d.repo] || d.repo;
            const entry = CATALOG.find((m) => m.key === key);
            const total = d.total || (entry ? entry.sizeMb * 1048576 : 0);
            broadcast('wg:models:progress', {
                key,
                name: entry ? entry.name : key,
                repo: d.repo,
                bytes: d.bytes || 0,
                total,
                done: !!d.done,
                error: d.error || null,
            });
            if (d.done) {
                scanCatalog();
                broadcastState();
            }
        });
        sidecar.armIdle(settingsStore.get().backend.idleUnloadMin);
        sidecar.start();

        recorder = new Recorder(paths.audioDir);
        statusWin = new StatusWindow({
            onClick: () => showWindow(),
            log: (line) => log('statuswin').debug(line),
        });
        live = new LiveTranscriber({
            sidecar,
            recorder,
            audioFile: path.join(paths.audioDir, '.live.wav'),
            getSettings: () => settingsStore.get(),
            getModelDir: modelDirFor,
            onPartial: (p) => broadcast('wg:live-partial', p),
        });

        const actions = setupActions();
        const moveBy = 40;
        const move = (dx, dy) => () => {
            if (!win || win.isDestroyed()) return;
            const [x, y] = win.getPosition();
            win.setPosition(x + dx, y + dy);
            win.emit('moved');
        };
        actions.moveUp = move(0, -moveBy);
        actions.moveDown = move(0, moveBy);
        actions.moveLeft = move(-moveBy, 0);
        actions.moveRight = move(moveBy, 0);

        keybinds = new KeybindManager(actions);
        applyKeybinds();
        updateTray();
        refreshKeybindInfo();

        registerIpc();

        healthTimer = setInterval(() => {
            sidecar.refreshHealth();
        }, 15000);
        healthTimer.unref?.();

        win.webContents.on('did-finish-load', () => {
            broadcastState();
        });

        win.on('closed', () => {
            win = null;
        });
    });

    app.on('before-quit', () => {
        if (healthTimer) clearInterval(healthTimer);
        if (recordCapTimer) clearTimeout(recordCapTimer);
        if (statusWin) statusWin.destroy();
        try {
            keybinds.unregister();
        } catch {}
        if (sidecar) sidecar.shutdown();
    });

    app.on('window-all-closed', () => {
        app.quit();
    });
}
