const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

const WIDTH = 320;
const HEIGHT = 64;

/**
 * Transient status pill — a tiny always-on-top window that shows what the
 * app is doing (recording / transcribing / done) even when the main overlay
 * window is hidden or minimized. Clicking it reveals the main window.
 */
class StatusWindow {
    constructor({ onClick, log = () => {} }) {
        this.onClick = onClick || (() => {});
        this.log = log;
        this.win = null;
        this._dismissTimer = null;
        this._lastPayload = null;
        this._listenerInstalled = false;
    }

    _position() {
        const wa = screen.getPrimaryDisplay().workArea;
        return { x: Math.round(wa.x + (wa.width - WIDTH) / 2), y: Math.round(wa.y + 12) };
    }

    _create() {
        if (this.win && !this.win.isDestroyed()) return this.win;
        const { x, y } = this._position();
        this.win = new BrowserWindow({
            width: WIDTH,
            height: HEIGHT,
            x,
            y,
            frame: false,
            transparent: true,
            hasShadow: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            resizable: false,
            movable: false,
            focusable: false,
            show: false,
            backgroundColor: '#00000000',
            webPreferences: {
                preload: path.join(__dirname, '..', 'preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
            },
        });
        this.win.setAlwaysOnTop(true, 'screen-saver');
        try {
            this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        } catch {}
        if (!this._listenerInstalled) {
            ipcMain.on('wg:statuswin:click', () => {
                this.log('status window clicked');
                this.onClick();
            });
            this._listenerInstalled = true;
        }
        this.win.loadFile(path.join(__dirname, '..', 'status-window.html'));
        this.win.once('ready-to-show', () => {
            this.win.showInactive();
            if (this._lastPayload) this._push(this._lastPayload);
        });
        this.win.on('closed', () => {
            this.win = null;
        });
        return this.win;
    }

    get visible() {
        return !!this.win && !this.win.isDestroyed() && this.win.isVisible();
    }

    _push(payload) {
        if (this.win && !this.win.isDestroyed()) {
            try {
                this.win.webContents.send('wg:statuswin:state', payload);
            } catch {}
        }
    }

    /**
     * Show the pill in a mode: 'recording' | 'transcribing' | 'done' | 'error'.
     * done/error auto-dismiss after `dismissMs` (default 2600ms).
     */
    show(mode, data = {}, { dismissMs = 0 } = {}) {
        if (this._dismissTimer) {
            clearTimeout(this._dismissTimer);
            this._dismissTimer = null;
        }
        const payload = { mode, startedAt: Date.now(), ...data };
        this._lastPayload = payload;
        this._create();
        this._push(payload);
        if (dismissMs) this._dismissTimer = setTimeout(() => this.hide(), dismissMs);
    }

    /** Update an already-visible pill without recreating the window. */
    update(mode, data = {}, { dismissMs = 0 } = {}) {
        if (!this.visible) {
            this.show(mode, data, { dismissMs });
            return;
        }
        if (this._dismissTimer) {
            clearTimeout(this._dismissTimer);
            this._dismissTimer = null;
        }
        const payload = { mode, startedAt: Date.now(), ...data };
        this._lastPayload = payload;
        this._push(payload);
        if (dismissMs) this._dismissTimer = setTimeout(() => this.hide(), dismissMs);
    }

    hide() {
        if (this._dismissTimer) {
            clearTimeout(this._dismissTimer);
            this._dismissTimer = null;
        }
        if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
    }

    destroy() {
        this.hide();
        if (this.win && !this.win.isDestroyed()) this.win.destroy();
        this.win = null;
    }
}

module.exports = { StatusWindow };
