const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MEDIA_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys';
const CUSTOM_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding';
const KB_ROOT = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings';

// Named system keybinds. Each gets its own dconf path + launcher script.
const BINDINGS = {
    toggle: { dir: 'whisperglass-toggle', name: 'WhisperGlass Toggle', arg: '--toggle' },
    record: { dir: 'whisperglass-record', name: 'WhisperGlass Record', arg: '--record' },
};

const ACTIONS = Object.keys(BINDINGS);

// Valid terminal keys in a gsettings accelerator (after comboToGsettings).
const KEY_RE =
    '([a-z0-9]|space|return|esc(?:ape)?|tab|backspace|delete|home|end|pgup|pgdn|insert|up|down|left|right|print|pause|f[0-9]|f1[0-2])';

function scriptPath(action) {
    return path.join(os.homedir(), '.local', 'bin', BINDINGS[action].dir);
}

function kbDir(action) {
    return `${KB_ROOT}/${BINDINGS[action].dir}`;
}

function kbSchemaPath(action) {
    return `${CUSTOM_SCHEMA}:${kbDir(action)}/`;
}

function run(cmd, args) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) reject(new Error(String(stderr || err.message).trim()));
            else resolve(String(stdout).trim());
        });
    });
}

// Map an app-style combo ("Ctrl+Shift+Space") to a gsettings accelerator
// ("<ctrl><shift>space"). Keys pass through lowercased; a few need renaming.
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
            if (lower === 'enter') return 'return';
            if (lower === 'pgup') return 'pgup';
            if (lower === 'pgdn') return 'pgdn';
            if (lower === 'esc') return 'escape';
            return lower;
        })
        .join('');
}

// Normalize a gsettings accelerator for comparison: lowercase, <control> → <ctrl>.
function normalizeBinding(binding) {
    return String(binding || '')
        .trim()
        .replace(/^'|'$/g, '')
        .toLowerCase()
        .replace(/<control>/g, '<ctrl>');
}

function isValidBinding(binding) {
    return new RegExp(`^(<ctrl>|<alt>|<shift>|<super>)*${KEY_RE}$`).test(binding);
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

async function setBindings(dirs) {
    await run('gsettings', ['set', MEDIA_SCHEMA, 'custom-keybindings', `[${dirs.map((b) => `'${b}'`).join(', ')}]`]);
}

function launcherScript(execPath, appPath, arg) {
    return appPath
        ? `#!/bin/sh\nexec "${execPath}" "${appPath}" ${arg}\n`
        : `#!/bin/sh\nexec "${execPath}" ${arg}\n`;
}

// Enumerate every registered custom keybinding (any dir) with its name/command/binding.
async function enumerateAll(oursDirs) {
    const dirs = (await getBindings()).filter(Boolean);
    const out = [];
    for (const dir of dirs) {
        const schema = `${CUSTOM_SCHEMA}:${dir.replace(/\/+$/, '')}/`;
        try {
            const [name, command, binding] = await Promise.all([
                run('gsettings', ['get', schema, 'name']).catch(() => ''),
                run('gsettings', ['get', schema, 'command']).catch(() => ''),
                run('gsettings', ['get', schema, 'binding']).catch(() => ''),
            ]);
            const isOurs = oursDirs.some((d) => d.replace(/\/+$/, '') === dir.replace(/\/+$/, ''));
            out.push({
                dir,
                name: name.replace(/^'|'$/g, ''),
                command: command.replace(/^'|'$/g, ''),
                binding: normalizeBinding(binding),
                ours: isOurs,
            });
        } catch {}
    }
    return out;
}

// Find other apps' bindings that own the same accelerator as one of ours —
// GNOME resolves duplicate accelerators by array order, so a shadowed binding
// silently never fires. Surface it instead.
async function scanConflicts(action, combo) {
    const ourDir = `${kbDir(action)}`;
    const all = await enumerateAll([ourDir]);
    const want = normalizeBinding(comboToGsettings(combo));
    return all
        .filter((b) => !b.ours && b.binding === want)
        .map((b) => ({ name: b.name, command: b.command, binding: b.binding, dir: b.dir }));
}

async function install({ action, combo, execPath, appPath, packaged }) {
    if (!BINDINGS[action]) throw new Error(`Unknown system keybind action: ${action}`);
    const binding = comboToGsettings(combo);
    if (!isValidBinding(binding)) {
        throw new Error('Combo must end with a plain key (letter, digit, space, F-key…)');
    }

    const conflicts = await scanConflicts(action, combo).catch(() => []);
    if (conflicts.length) {
        const other = conflicts[0];
        throw new Error(
            `That combo is already registered by "${other.name || 'another app'}" (${other.command || 'unknown command'}) via GNOME custom keybindings. ` +
                'Remove or change the other binding, or pick a different combo.'
        );
    }

    const binDir = path.dirname(scriptPath(action));
    fs.mkdirSync(binDir, { recursive: true });
    const script = launcherScript(execPath, packaged ? null : appPath, BINDINGS[action].arg);
    fs.writeFileSync(scriptPath(action), script, { mode: 0o755 });
    fs.chmodSync(scriptPath(action), 0o755);

    const bindings = await getBindings();
    const entry = `${kbDir(action)}/`;
    if (!bindings.includes(entry)) {
        bindings.push(entry);
        await setBindings(bindings);
    }
    await run('gsettings', ['set', kbSchemaPath(action), 'name', BINDINGS[action].name]);
    await run('gsettings', ['set', kbSchemaPath(action), 'command', scriptPath(action)]);
    await run('gsettings', ['set', kbSchemaPath(action), 'binding', binding]);
    return { script: scriptPath(action), binding };
}

async function uninstall(action) {
    if (action && !BINDINGS[action]) throw new Error(`Unknown system keybind action: ${action}`);
    const actions = action ? [action] : ACTIONS;
    try {
        const bindings = await getBindings();
        const kept = bindings.filter((b) => !actions.some((a) => b === `${kbDir(a)}/`));
        if (kept.length !== bindings.length) await setBindings(kept);
    } catch {}
    for (const a of actions) {
        for (const key of ['name', 'command', 'binding']) {
            try {
                await run('gsettings', ['reset', kbSchemaPath(a), key]);
            } catch {}
        }
        try {
            fs.unlinkSync(scriptPath(a));
        } catch {}
    }
    return { ok: true };
}

async function status() {
    const gnome = await isGnome();
    const info = { gnome, bindings: {}, conflicts: [], error: '' };
    if (!gnome) {
        for (const a of ACTIONS) info.bindings[a] = { installed: false, combo: '', scriptOk: false };
        return info;
    }
    try {
        const all = await enumerateAll(ACTIONS.map((a) => kbDir(a)));
        for (const a of ACTIONS) {
            const mine = all.find((b) => b.ours && b.dir.replace(/\/+$/, '') === kbDir(a));
            const installed = !!mine;
            let scriptOk = false;
            let combo = '';
            if (installed) {
                combo = mine.binding;
                scriptOk = fs.existsSync(scriptPath(a));
            }
            info.bindings[a] = { installed, combo, scriptOk };
        }
        // conflicts: other apps shadowing any of our *installed* bindings
        const oursInstalled = all.filter((b) => b.ours);
        for (const mine of oursInstalled) {
            for (const other of all) {
                if (other.ours || other.binding !== mine.binding) continue;
                const action = ACTIONS.find((a) => other && mine.dir.includes(BINDINGS[a].dir));
                info.conflicts.push({
                    action,
                    name: other.name,
                    command: other.command,
                    binding: mine.binding,
                });
            }
        }
    } catch (err) {
        info.error = String(err.message || err);
    }
    return info;
}

module.exports = {
    install,
    uninstall,
    status,
    isGnome,
    scanConflicts,
    comboToGsettings,
    normalizeBinding,
    isValidBinding,
    parseGvariantArray,
    ACTIONS,
    BINDINGS,
    scriptPath,
};
