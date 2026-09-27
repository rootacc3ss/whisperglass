const { BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_WIDTH = 760;
const DEFAULT_HEIGHT = 560;

function loadWindowState(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function clampToBounds(state) {
    const displays = screen.getAllDisplays();
    if (!displays.length) return state;
    let visible = false;
    for (const display of displays) {
        const { x, y, width, height } = display.workArea;
        if (state.x + state.width - 40 > x && state.x + 40 < x + width && state.y >= y - 10 && state.y < y + height) {
            visible = true;
            break;
        }
    }
    if (!visible) return null;
    return state;
}

function createMainWindow(paths, { onboarded }) {
    const file = paths.windowStateFile;
    let bounds = clampToBounds({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, ...(loadWindowState(file) || {}) });
    if (!bounds) {
        const { workArea } = screen.getPrimaryDisplay();
        bounds = {
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            x: Math.floor(workArea.x + (workArea.width - DEFAULT_WIDTH) / 2),
            y: Math.floor(workArea.y + 40),
        };
    }

    const win = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        frame: false,
        transparent: true,
        hasShadow: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        backgroundColor: '#00000000',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
            webSecurity: true,
        },
    });

    win.setAlwaysOnTop(true, 'screen-saver');
    try {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {}
    win.loadFile(path.join(__dirname, '..', 'index.html'));
    win.once('ready-to-show', () => {
        win.showInactive();
    });

    let saveTimer = null;
    const persist = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            try {
                if (!win.isVisible()) return;
                const [x, y] = win.getPosition();
                const [width, height] = win.getSize();
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, JSON.stringify({ x, y, width, height }));
            } catch {}
        }, 500);
    };
    win.on('moved', persist);
    win.on('resized', persist);
    win.on('closed', () => {
        if (saveTimer) clearTimeout(saveTimer);
    });

    return win;
}

module.exports = { createMainWindow };
