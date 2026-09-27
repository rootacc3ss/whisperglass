const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

function createTray(actions) {
    const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
    let image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
        image = image.resize({ width: 22, height: 22 });
    }
    const tray = new Tray(image);
    tray.setToolTip('WhisperGlass');
    const rebuild = () => {
        tray.setContextMenu(
            Menu.buildFromTemplate([
                { label: 'Show WhisperGlass', click: actions.onShow },
                { type: 'separator' },
                { label: 'Start / stop recording', click: actions.onToggleRecording },
                { label: 'New session', click: actions.onNewSession },
                { label: 'Settings', click: actions.onSettings },
                { type: 'separator' },
                { label: 'Quit', click: actions.onQuit },
            ])
        );
    };
    rebuild();
    tray.on('click', actions.onShow);
    return {
        tray,
        destroy() {
            try {
                tray.destroy();
            } catch {}
        },
    };
}

module.exports = { createTray };
