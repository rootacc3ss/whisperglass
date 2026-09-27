const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MEDIA_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys';
const CUSTOM_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding';
const KB_DIR = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/whisperglass-toggle';
const KB_SCHEMA_PATH = `${CUSTOM_SCHEMA}:${KB_DIR}/`;
const SCRIPT_PATH = path.join(os.homedir(), '.local', 'bin', 'whisperglass-toggle');

function run(cmd, args) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) reject(new Error(String(stderr || err.message).trim()));
            else resolve(String(stdout).trim());
        });
    });
}

function comboToGsettings(combo) {
    return String(combo || '')
        .split('+')
        .filter(Boolean)
        .map((part) => {
            const lower = part.toLowerCase();
            if (lower === 'ctrl' || lower === 'control') return '<ctrl>';
            if (lower === 'alt') return '<alt>';
            if (lower === 'shift') return '<shift>';
            if (lower === 'super' || lower === 'win' || lower === 'meta') return '<super>';
            return lower;
        })
        .join('');
}

function parseGvariantArray(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed || trimmed === '@as []') return [];
    try {
        return JSON.parse(trimmed.replace(/'/g, '"'));
    } catch {
        return [];
    }
}

async function hasGsettings() {
    try {
        await run('which', ['gsettings']);
        return true;
    } catch {
        return false;
    }
}

async function isGnome() {
    const desktop = process.env.XDG_CURRENT_DESKTOP || '';
    if (!/gnome/i.test(desktop)) return false;
    return hasGsettings();
}

async function getBindings() {
    const out = await run('gsettings', ['get', MEDIA_SCHEMA, 'custom-keybindings']);
    return parseGvariantArray(out);
}

function launcherScript(execPath, appPath) {
    return appPath ? `#!/bin/sh\nexec "${execPath}" "${appPath}" --toggle\n` : `#!/bin/sh\nexec "${execPath}" --toggle\n`;
}

async function install({ combo, execPath, appPath, packaged }) {
    const binding = comboToGsettings(combo);
    if (!/^(<ctrl>|<alt>|<shift>|<super>)*[a-z0-9]$/.test(binding)) {
        throw new Error('Combo must end with a plain key (letter or digit)');
    }
    const binDir = path.dirname(SCRIPT_PATH);
    fs.mkdirSync(binDir, { recursive: true });
    const script = launcherScript(execPath, packaged ? null : appPath);
    fs.writeFileSync(SCRIPT_PATH, script, { mode: 0o755 });
    fs.chmodSync(SCRIPT_PATH, 0o755);

    const bindings = await getBindings();
    if (!bindings.includes(`${KB_DIR}/`)) {
        bindings.push(`${KB_DIR}/`);
        await run('gsettings', ['set', MEDIA_SCHEMA, 'custom-keybindings', `[${bindings.map((b) => `'${b}'`).join(', ')}]`]);
    }
    await run('gsettings', ['set', KB_SCHEMA_PATH, 'name', 'WhisperGlass Toggle']);
    await run('gsettings', ['set', KB_SCHEMA_PATH, 'command', SCRIPT_PATH]);
    await run('gsettings', ['set', KB_SCHEMA_PATH, 'binding', binding]);
    return { script: SCRIPT_PATH, binding };
}

async function uninstall() {
    try {
        const bindings = await getBindings();
        const kept = bindings.filter((b) => b !== `${KB_DIR}/`);
        if (kept.length !== bindings.length) {
            await run('gsettings', ['set', MEDIA_SCHEMA, 'custom-keybindings', `[${kept.map((b) => `'${b}'`).join(', ')}]`]);
        }
    } catch {}
    for (const key of ['name', 'command', 'binding']) {
        try {
            await run('gsettings', ['reset', KB_SCHEMA_PATH, key]);
        } catch {}
    }
    try {
        fs.unlinkSync(SCRIPT_PATH);
    } catch {}
    return { ok: true };
}

async function status() {
    const gnome = await isGnome();
    const info = { gnome, installed: false, combo: '', scriptOk: false, error: '' };
    if (!gnome) return info;
    try {
        const bindings = await getBindings();
        info.installed = bindings.includes(`${KB_DIR}/`);
        if (info.installed) {
            info.combo = await run('gsettings', ['get', KB_SCHEMA_PATH, 'binding']);
            info.scriptOk = fs.existsSync(SCRIPT_PATH);
        }
    } catch (err) {
        info.error = String(err.message || err);
    }
    return info;
}

module.exports = { install, uninstall, status, isGnome, comboToGsettings, parseGvariantArray, SCRIPT_PATH };
