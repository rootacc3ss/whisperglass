const { globalShortcut } = require('electron');

const ACTIONS = ['toggleVisibility', 'toggleRecording', 'newSession', 'toggleSidebar', 'moveUp', 'moveDown', 'moveLeft', 'moveRight'];

const DEFAULT_KEYBINDS = {
    toggleVisibility: 'Ctrl+\\',
    toggleRecording: 'Ctrl+Shift+Space',
    newSession: 'Ctrl+Shift+N',
    toggleSidebar: 'Ctrl+Shift+B',
    moveUp: 'Ctrl+Alt+ArrowUp',
    moveDown: 'Ctrl+Alt+ArrowDown',
    moveLeft: 'Ctrl+Alt+ArrowLeft',
    moveRight: 'Ctrl+Alt+ArrowRight',
    systemKeybind: false,
    systemRecord: false,
};

function normalizeAccelerator(acc) {
    return String(acc || '')
        .split('+')
        .map((part) => (part.startsWith('Arrow') ? part.slice(5) : part))
        .filter(Boolean)
        .join('+');
}

class KeybindManager {
    constructor(actions) {
        this.actions = actions || {};
        this.map = { ...DEFAULT_KEYBINDS };
    }

    register(map) {
        this.unregister();
        const provided = map || {};
        this.map = { ...DEFAULT_KEYBINDS, ...provided };
        for (const action of ACTIONS) {
            if (!(action in provided)) continue;
            const acc = normalizeAccelerator(this.map[action]);
            if (!acc || typeof this.actions[action] !== 'function') continue;
            try {
                globalShortcut.register(acc, () => this.actions[action]());
            } catch {
                this.map[action] = null;
            }
        }
        return this.map;
    }

    unregister() {
        try {
            globalShortcut.unregisterAll();
        } catch {}
    }
}

module.exports = { KeybindManager, DEFAULT_KEYBINDS, ACTIONS, normalizeAccelerator };
