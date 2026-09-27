import { toast } from '../components/common/wg-toast.js';
import { sortAudioInputs } from './audio-devices.js';

const wg = () => window.wg;

function dbg(message, data, level = 'debug') {
    try {
        wg()?.send('wg:debug:log', { scope: 'capture', level, message, data });
    } catch {}
}

let workletURL = null;

function getWorkletURL() {
    if (workletURL) return workletURL;
    const code = `
class WgPCM extends AudioWorkletProcessor {
  constructor() { super(); this._buf = new Float32Array(4096); this._off = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      let n = ch.length, o = 0;
      while (n > 0) {
        const take = Math.min(n, this._buf.length - this._off);
        this._buf.set(ch.subarray(o, o + take), this._off);
        this._off += take; o += take; n -= take;
        if (this._off === this._buf.length) { this.port.postMessage(this._buf.slice(0)); this._off = 0; }
      }
    }
    return true;
  }
}
registerProcessor('wg-pcm', WgPCM);`;
    workletURL = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    return workletURL;
}

export const micState = {
    capturing: false,
    levels: [],
    startedAt: 0,
    error: null,
    deviceLabel: '',
};

let micDeviceId = '';
let micLabel = '';
let devicesProbed = false;
let recordingActive = false;
let enumCache = { at: 0, devices: [] };

const listeners = new Set();

export function onMicUpdate(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

function emit() {
    for (const cb of listeners) cb();
}

async function enumerateAudioInputs() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices
            .filter((d) => d.kind === 'audioinput')
            .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Microphone' }));
        enumCache = { at: Date.now(), devices: inputs };
        return inputs;
    } catch {
        return [];
    }
}

export async function listAudioInputs() {
    if (!devicesProbed) {
        try {
            dbg('permission probe start');
            const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
            probe.getTracks().forEach((t) => t.stop());
            devicesProbed = true;
            dbg('permission probe ok');
        } catch (err) {
            dbg('permission probe failed', { name: err.name, message: err.message }, 'info');
        }
    }
    const inputs = await enumerateAudioInputs();
    const sorted = sortAudioInputs(inputs);
    dbg('audio inputs enumerated', { count: sorted.length, devices: sorted.map((d) => ({ id: d.deviceId, label: d.label })) });
    return sorted;
}

let stream = null;
let ctx = null;
let node = null;
let stopping = false;
let chunkIndex = 0;
let sawSignal = false;
let healed = false;
let usedExplicitDevice = false;

const SIGNAL_RMS = 0.004;
const SILENCE_CHUNKS = 16;

async function _startCapture(forceDefault) {
    if (micState.capturing || stopping || !recordingActive) return;
    micState.error = null;
    const constraints = {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000,
    };
    let requestedId = '';
    if (!forceDefault && (micDeviceId || micLabel)) {
        const fresh = Date.now() - enumCache.at > 5000 ? await enumerateAudioInputs() : enumCache.devices;
        let resolved = '';
        let resolveReason = '';
        if (micDeviceId && fresh.some((d) => d.deviceId === micDeviceId)) {
            resolved = micDeviceId;
            resolveReason = 'id';
        } else if (micLabel) {
            const byLabel = fresh.find((d) => d.label && d.label.toLowerCase() === micLabel.toLowerCase());
            if (byLabel) {
                resolved = byLabel.deviceId;
                resolveReason = 'label';
            }
        }
        dbg('stored device check', {
            micDeviceId,
            micLabel,
            existsInEnumeration: !!resolved,
            resolveReason,
            enumerated: fresh.length,
        });
        if (resolved) {
            requestedId = resolved;
            constraints.deviceId = { exact: resolved };
        } else {
            dbg('stored device not found — falling back to system default', null, 'info');
            toast('Saved microphone not found — using system default', 'error', 5000);
            try {
                await wg().invoke('wg:settings:set', { micDeviceId: '', micLabel: '' });
            } catch {}
        }
    }
    usedExplicitDevice = !!requestedId;
    dbg('getUserMedia attempt', { requestedId, constraints, forceDefault });
    try {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
        } catch (err) {
            dbg('getUserMedia failed', { name: err.name, message: err.message, constraint: err.constraint }, 'info');
            if (requestedId && ['OverconstrainedError', 'NotFoundError', 'NotReadableError'].includes(err.name)) {
                toast('Selected microphone unavailable — using system default', 'error', 5000);
                delete constraints.deviceId;
                requestedId = '';
                usedExplicitDevice = false;
                dbg('retrying without deviceId');
                stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
            } else {
                throw err;
            }
        }
        const track = stream.getAudioTracks()[0];
        if (track) {
            micState.deviceLabel = track.label || '';
            const settings = track.getSettings();
            dbg('stream opened', {
                requestedId,
                openedLabel: micState.deviceLabel,
                openedDeviceId: settings.deviceId,
                trackMuted: track.muted,
                trackEnabled: track.enabled,
                trackSettings: settings,
            });
            if (track.muted) {
                dbg('track reports OS-level mute', { openedLabel: micState.deviceLabel }, 'info');
                toast(
                    `"${micState.deviceLabel || 'Microphone'}" is muted at the OS level — unmute it (GNOME quick settings / mic-mute key)`,
                    'error',
                    8000
                );
            }
            if (requestedId && settings.deviceId && requestedId !== settings.deviceId) {
                dbg('opened device differs from requested', { requestedId, opened: settings.deviceId }, 'info');
                toast(`Capturing "${micState.deviceLabel}" instead of the selected device`, 'error', 5000);
            }
        }
        ctx = new AudioContext({ sampleRate: 16000 });
        dbg('audio context created', { state: ctx.state, sampleRate: ctx.sampleRate });
        await ctx.audioWorklet.addModule(getWorkletURL());
        dbg('worklet module loaded');
        const source = ctx.createMediaStreamSource(stream);
        node = new AudioWorkletNode(ctx, 'wg-pcm', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
        });
        chunkIndex = 0;
        sawSignal = false;
        node.port.onmessage = (e) => {
            const f32 = e.data;
            const i16 = new Int16Array(f32.length);
            let sum = 0;
            for (let i = 0; i < f32.length; i++) {
                const s = Math.max(-1, Math.min(1, f32[i]));
                i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
                sum += s * s;
            }
            const rms = Math.sqrt(sum / f32.length);
            if (rms > SIGNAL_RMS) sawSignal = true;
            micState.levels.push(rms);
            if (micState.levels.length > 56) micState.levels.shift();
            if (chunkIndex < 20 || chunkIndex % 25 === 0) {
                dbg('worklet chunk', { n: chunkIndex, samples: f32.length, rms, sawSignal });
            }
            chunkIndex += 1;
            if (!sawSignal && chunkIndex === SILENCE_CHUNKS) {
                onSilenceDetected();
            }
            wg()?.send('wg:rec-chunk', { buffer: i16.buffer, rms });
            emit();
        };
        source.connect(node);
        node.connect(ctx.destination);
        micState.capturing = true;
        micState.startedAt = Date.now();
        micState.levels = [];
        dbg('capture live', { deviceLabel: micState.deviceLabel, contextState: ctx.state });
        emit();
    } catch (err) {
        micState.error = String((err && err.message) || err);
        dbg('capture failed', { name: err.name, message: micState.error }, 'info');
        emit();
        toast(`Microphone error: ${micState.error}`, 'error', 4200);
        try {
            wg()?.invoke('wg:rec:cancel');
        } catch {}
    }
}

function onSilenceDetected() {
    dbg('silence watchdog triggered', {
        deviceLabel: micState.deviceLabel,
        usedExplicitDevice,
        healed,
        contextState: ctx ? ctx.state : null,
    }, 'info');
    if (usedExplicitDevice && !healed) {
        healed = true;
        toast(`No signal from "${micState.deviceLabel}" — retrying with system default`, 'error', 6000);
        dbg('auto-heal: restarting capture on system default', null, 'info');
        stopCapture();
        setTimeout(() => {
            if (recordingActive) _startCapture(true);
        }, 350);
    } else {
        toast('No mic signal — mic muted at the OS level? Try the signal test in Settings → Audio', 'error', 7000);
    }
}

export async function startCapture() {
    recordingActive = true;
    healed = false;
    micState.deviceLabel = '';
    dbg('capture start requested', { micDeviceId });
    return _startCapture(false);
}

function _teardownGraph() {
    const s = stream;
    const c = ctx;
    const n = node;
    stream = null;
    ctx = null;
    node = null;
    try {
        if (n) n.disconnect();
    } catch {}
    try {
        if (s) s.getTracks().forEach((t) => t.stop());
    } catch {}
    try {
        if (c) c.close();
    } catch {}
}

export function stopCapture() {
    if (!micState.capturing) return;
    stopping = true;
    micState.capturing = false;
    emit();
    dbg('capture stopped', { chunks: chunkIndex, sawSignal, deviceLabel: micState.deviceLabel });
    _teardownGraph();
    setTimeout(() => {
        stopping = false;
    }, 300);
}

export function micLevelToHeight(rms) {
    return Math.min(1, Math.pow(rms, 0.55) * 1.7);
}

wg().on('wg:state', (s) => {
    micDeviceId = (s && s.settings && s.settings.micDeviceId) || '';
    micLabel = (s && s.settings && s.settings.micLabel) || '';
});
wg().on('wg:rec-started', () => startCapture());
wg().on('wg:rec-stopped', () => {
    recordingActive = false;
    stopCapture();
});
wg().on('wg:rec-cancelled', () => {
    recordingActive = false;
    stopCapture();
});
