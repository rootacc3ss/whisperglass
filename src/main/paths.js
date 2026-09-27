const { app } = require('electron');
const path = require('path');
const fs = require('fs');

function getPaths() {
    const home = app.getPath('home');
    const configDir = path.join(home, '.config', 'whisperglass');
    const dataDir = path.join(home, '.local', 'share', 'whisperglass');
    return {
        configDir,
        dataDir,
        settingsFile: path.join(configDir, 'settings.json'),
        appStateFile: path.join(configDir, 'app-state.json'),
        windowStateFile: path.join(configDir, 'window-state.json'),
        sessionsDir: path.join(dataDir, 'sessions'),
        modelsDir: path.join(dataDir, 'models'),
        audioDir: path.join(dataDir, 'audio'),
        venvDir: path.join(dataDir, 'venv'),
        sidecarLog: path.join(dataDir, 'sidecar.log'),
        appLog: path.join(dataDir, 'whisperglass.log'),
        onboardedMarker: path.join(dataDir, '.onboarded'),
        sidecarDir: app.isPackaged
            ? path.join(process.resourcesPath, 'sidecar')
            : path.join(__dirname, '..', '..', 'sidecar'),
    };
}

function ensureDirs(paths) {
    for (const dir of [paths.configDir, paths.dataDir, paths.sessionsDir, paths.modelsDir, paths.audioDir]) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

module.exports = { getPaths, ensureDirs };
