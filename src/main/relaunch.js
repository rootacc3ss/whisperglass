// AppImage-safe relaunch/exec paths.
//
// Inside an AppImage, process.execPath points into the ephemeral FUSE mount
// (/tmp/.mount_*), which the AppImage runtime unmounts as the first process
// exits — a relaunch (or a keybind launcher script) targeting it dies
// silently ("nothing happens at all"). When $APPIMAGE is set, target the
// AppImage file itself; a stable real path.
//
// Upstream references: electron-builder#1727, dsh-desktop#1226 (Electron 44),
// meru PR #1085, clawd-on-desk#1048.

function relaunchOptions(args) {
    const options = { args };
    if (process.env.APPIMAGE) options.execPath = process.env.APPIMAGE;
    return options;
}

function keybindExecPath() {
    return process.env.APPIMAGE || process.execPath;
}

module.exports = { relaunchOptions, keybindExecPath };
