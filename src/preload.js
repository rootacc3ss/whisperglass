const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL_RE = /^wg:[a-z0-9:-]+$/;

function check(channel) {
    if (!CHANNEL_RE.test(channel)) throw new Error(`Invalid channel: ${channel}`);
}

contextBridge.exposeInMainWorld('wg', {
    invoke: (channel, payload) => {
        check(channel);
        return ipcRenderer.invoke(channel, payload);
    },
    send: (channel, payload) => {
        check(channel);
        ipcRenderer.send(channel, payload);
    },
    on: (channel, cb) => {
        check(channel);
        const listener = (_event, payload) => cb(payload);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
    },
    platform: process.platform,
});
