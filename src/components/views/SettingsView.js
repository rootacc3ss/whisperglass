import { html, css, LitElement } from '../../assets/lit-core.min.js';
import '../common/wg-icon.js';
import { toast } from '../common/wg-toast.js';
import { listAudioInputs } from '../../utils/mic.js';
import { micLevelToHeight } from '../../utils/mic.js';

const LANGUAGES = [
    ['auto', 'Auto-detect'],
    ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
    ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['pl', 'Polish'],
    ['sv', 'Swedish'], ['no', 'Norwegian'], ['da', 'Danish'], ['fi', 'Finnish'], ['cs', 'Czech'],
    ['el', 'Greek'], ['tr', 'Turkish'], ['ar', 'Arabic'], ['he', 'Hebrew'], ['hi', 'Hindi'],
    ['bn', 'Bengali'], ['ta', 'Tamil'], ['th', 'Thai'], ['vi', 'Vietnamese'], ['id', 'Indonesian'],
    ['ms', 'Malay'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'],
];

const KEYBIND_ACTIONS = [
    ['toggleRecording', 'Start / stop recording'],
    ['toggleVisibility', 'Show / hide window'],
    ['newSession', 'New session'],
    ['toggleSidebar', 'Toggle sessions panel'],
];

const DEFAULT_KEYBINDS = {
    toggleRecording: 'Ctrl+Shift+Space',
    toggleVisibility: 'Ctrl+\\',
    newSession: 'Ctrl+Shift+N',
    toggleSidebar: 'Ctrl+Shift+B',
};

const ACCENTS = ['#007aff', '#34d399', '#fbbf24', '#ef4444', '#a78bfa', '#e879f9', '#e5e5e7'];

function fmtSize(sizeMb) {
    return sizeMb >= 1000 ? `${(sizeMb / 1000).toFixed(1)} GB` : `${sizeMb} MB`;
}

class SettingsView extends LitElement {
    static properties = {
        settings: { type: Object },
        status: { type: Object },
        catalog: { type: Array },
        keybindInfo: { type: Object },
        modelsProgress: { type: Object },
        backendLog: { type: Array },
        _capturing: { state: true },
        _systemCombo: { state: true },
        _sysBusy: { state: true },
        _devices: { state: true },
        _devicesLoading: { state: true },
        _logTail: { state: true },
        _testing: { state: true },
        _testLevel: { state: true },
        _testLabel: { state: true },
    };

    constructor() {
        super();
        this.settings = null;
        this.status = null;
        this.catalog = [];
        this.keybindInfo = null;
        this.modelsProgress = {};
        this.backendLog = [];
        this._capturing = null;
        this._captureHandler = null;
        this._systemCombo = 'Alt+Shift+T';
        this._sysBusy = false;
        this._devices = [];
        this._devicesLoading = false;
        this._logTail = '';
        this._testing = false;
        this._testLevel = 0;
        this._testLabel = '';
        this._testRaf = 0;
        this._testStream = null;
        this._testCtx = null;
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._stopTestMic();
    }

    firstUpdated() {
        this._refreshDevices();
        this._loadLogTail();
    }

    async _refreshDevices() {
        this._devicesLoading = true;
        try {
            this._devices = await listAudioInputs();
        } catch {
            this._devices = [];
        }
        this._devicesLoading = false;
    }

    async _loadLogTail() {
        try {
            const res = await window.wg.invoke('wg:debug:read-log');
            this._logTail = (res && res.log) || '';
        } catch {
            this._logTail = '';
        }
    }

    async _copyLog() {
        const res = await window.wg.invoke('wg:debug:read-log');
        const lines = ((res && res.log) || '').split('\n').slice(-50).join('\n');
        try {
            await navigator.clipboard.writeText(lines);
            toast('Last 50 log lines copied', 'success');
        } catch {
            toast('Copy failed — use Open log instead', 'error');
        }
    }

    async _testMic() {
        if (this._testing) {
            this._stopTestMic();
            return;
        }
        const s = this.settings;
        const constraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        const id = s?.micDeviceId && this._devices.some((d) => d.deviceId === s.micDeviceId)
            ? s.micDeviceId
            : (this._devices.find((d) => d.label && d.label === s?.micLabel) || {}).deviceId || '';
        if (id) constraints.deviceId = { exact: id };
        this._testing = true;
        this._testLevel = 0;
        this._testLabel = '';
        try {
            this._testStream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
            const track = this._testStream.getAudioTracks()[0];
            this._testLabel = track ? track.label || '' : '';
            this._testCtx = new AudioContext();
            const source = this._testCtx.createMediaStreamSource(this._testStream);
            const analyser = this._testCtx.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);
            const buf = new Float32Array(analyser.fftSize);
            const tick = () => {
                if (!this._testing) return;
                analyser.getFloatTimeDomainData(buf);
                let sum = 0;
                for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
                this._testLevel = Math.sqrt(sum / buf.length);
                this.requestUpdate();
                this._testRaf = requestAnimationFrame(tick);
            };
            tick();
            this._testTimeout = setTimeout(() => this._stopTestMic(), 12000);
        } catch (err) {
            this._testing = false;
            toast(`Signal test failed: ${err.name || err.message}`, 'error', 5000);
        }
    }

    _stopTestMic() {
        this._testing = false;
        this._testLevel = 0;
        if (this._testRaf) cancelAnimationFrame(this._testRaf);
        this._testRaf = 0;
        if (this._testTimeout) clearTimeout(this._testTimeout);
        this._testTimeout = null;
        try {
            if (this._testStream) this._testStream.getTracks().forEach((t) => t.stop());
        } catch {}
        try {
            if (this._testCtx) this._testCtx.close();
        } catch {}
        this._testStream = null;
        this._testCtx = null;
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._stopCapture();
    }

    _patch(patch) {
        this.dispatchEvent(new CustomEvent('settings-patch', { detail: patch, bubbles: true, composed: true }));
    }

    _toggle(key, value) {
        this._patch({ [key]: value });
    }

    _startCapture(action) {
        this._stopCapture();
        if (action === 'systemToggle') {
            this._capturing = 'systemToggle';
            this._captureHandler = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.key === 'Escape') {
                    this._stopCapture();
                    return;
                }
                if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
                const parts = [];
                if (e.ctrlKey) parts.push('Ctrl');
                if (e.altKey) parts.push('Alt');
                if (e.shiftKey) parts.push('Shift');
                if (e.metaKey) parts.push('Super');
                let key = e.key;
                if (key === ' ') key = 'Space';
                else if (key.length === 1) key = key.toUpperCase();
                parts.push(key);
                const accelerator = parts.join('+');
                if (!['Alt', 'Ctrl', 'Shift', 'Super'].includes(key)) {
                    const conflict = Object.values(this.settings?.keybinds || {}).some((acc) => acc === accelerator);
                    if (conflict) {
                        toast('That combo is already used by another action', 'error');
                        return;
                    }
                }
                this._systemCombo = accelerator;
                this._stopCapture();
            };
            window.addEventListener('keydown', this._captureHandler, true);
            return;
        }
        this._capturing = action;
        this._captureHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Escape') {
                this._stopCapture();
                return;
            }
            if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
            const parts = [];
            if (e.ctrlKey) parts.push('Ctrl');
            if (e.altKey) parts.push('Alt');
            if (e.shiftKey) parts.push('Shift');
            if (e.metaKey) parts.push('Super');
            let key = e.key;
            if (key === ' ') key = 'Space';
            else if (key.length === 1) key = key.toUpperCase();
            parts.push(key);
            const accelerator = parts.join('+');
            const keybinds = { ...(this.settings?.keybinds || {}) };
            const conflict = Object.entries(keybinds).find(([a, acc]) => a !== action && acc === accelerator);
            if (conflict) {
                toast(`Already used by "${KEYBIND_ACTIONS.find(([a]) => a === conflict[0])?.[1] || conflict[0]}"`, 'error');
                return;
            }
            keybinds[action] = accelerator;
            this.dispatchEvent(new CustomEvent('settings-patch', { detail: { keybinds }, bubbles: true, composed: true }));
            this._stopCapture();
        };
        window.addEventListener('keydown', this._captureHandler, true);
    }

    _stopCapture() {
        if (this._captureHandler) {
            window.removeEventListener('keydown', this._captureHandler, true);
            this._captureHandler = null;
        }
        this._capturing = null;
    }

    async _installSystemKeybind() {
        this._sysBusy = true;
        const res = await window.wg.invoke('wg:keybinds:install-system', { combo: this._systemCombo });
        this._sysBusy = false;
        if (res && res.ok) toast(`System keybind installed — ${this._systemCombo}`, 'success');
        else toast(`Install failed: ${res?.error || 'unknown error'}`, 'error', 6000);
    }

    async _uninstallSystemKeybind() {
        this._sysBusy = true;
        await window.wg.invoke('wg:keybinds:uninstall-system');
        this._sysBusy = false;
        toast('System keybind removed', 'info');
    }

    static styles = css`
        :host {
            display: block;
            overflow-y: auto;
            width: 100%;
        }
        .wrap {
            max-width: 620px;
            margin: 0 auto;
            padding: 16px 16px 30px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .card {
            background: var(--card-background);
            border: 1px solid var(--button-border);
            border-radius: 6px;
            backdrop-filter: blur(10px);
            padding: 14px 16px;
        }
        .section-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-color);
            margin-bottom: 12px;
        }
        .section-title::before {
            content: '';
            width: 3px;
            height: 14px;
            background: var(--accent);
            border-radius: 2px;
            display: inline-block;
        }
        .row {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        .setting {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 7px 0;
            min-height: 34px;
        }
        .setting + .setting {
            border-top: 1px solid rgba(255, 255, 255, 0.05);
        }
        .setting .label {
            font-size: 13px;
        }
        .setting .sub {
            display: block;
            font-size: 11px;
            color: var(--text-dim);
            margin-top: 2px;
        }
        select,
        input[type='text'],
        input[type='password'],
        textarea {
            background: var(--input-background);
            border: 1px solid var(--button-border);
            border-radius: 6px;
            color: var(--text-color);
            padding: 6px 10px;
            font-size: 13px;
            outline: none;
            min-width: 120px;
        }
        select:focus,
        input:focus,
        textarea:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 3px var(--accent-dim);
        }
        textarea {
            width: 100%;
            min-height: 56px;
            resize: vertical;
            font-family: inherit;
        }
        .radio {
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--button-border);
            border-radius: 8px;
            padding: 8px 14px;
            cursor: pointer;
            user-select: none;
            flex: 1;
            min-width: 110px;
            justify-content: center;
        }
        .radio:hover {
            background: var(--hover-background);
        }
        .radio.on {
            border-color: var(--accent);
            background: var(--accent-dim);
        }
        .radio .mark {
            width: 13px;
            height: 13px;
            border-radius: 50%;
            border: 1.5px solid var(--text-dim);
            flex: none;
            position: relative;
        }
        .radio.on .mark {
            border-color: var(--accent);
        }
        .radio.on .mark::after {
            content: '';
            position: absolute;
            inset: 2.5px;
            border-radius: 50%;
            background: var(--accent);
        }
        .radio .rl {
            font-size: 13px;
            font-weight: 500;
        }
        .radio .rs {
            font-size: 10.5px;
            color: var(--text-dim);
        }
        .switch {
            width: 34px;
            height: 20px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.14);
            border: none;
            cursor: pointer;
            position: relative;
            flex: none;
            transition: background 0.2s ease;
            padding: 0;
        }
        .switch::after {
            content: '';
            position: absolute;
            top: 2px;
            left: 2px;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #fff;
            transition: transform 0.2s ease;
        }
        .switch[aria-checked='true'] {
            background: var(--accent);
        }
        .switch[aria-checked='true']::after {
            transform: translateX(14px);
        }
        .model {
            display: flex;
            align-items: center;
            gap: 10px;
            border: 1px solid var(--button-border);
            border-radius: 8px;
            padding: 9px 12px;
            cursor: pointer;
        }
        .model:hover {
            background: var(--hover-background);
        }
        .model.on {
            border-color: var(--accent);
            background: var(--accent-dim);
        }
        .model .name {
            font-size: 13px;
            font-weight: 500;
        }
        .model .size {
            font-size: 11px;
            color: var(--text-dim);
            font-family: var(--mono);
        }
        .model .spacer {
            flex: 1;
        }
        .tag {
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-radius: 4px;
            padding: 2px 6px;
            background: rgba(255, 255, 255, 0.08);
            color: var(--text-dim);
        }
        .tag.rec {
            background: var(--accent-dim);
            color: var(--text-color);
        }
        .tag.ok {
            background: rgba(52, 211, 153, 0.15);
            color: var(--success);
        }
        .icon-btn {
            background: none;
            border: none;
            color: var(--text-dim);
            width: 24px;
            height: 24px;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            padding: 0;
            flex: none;
        }
        .icon-btn:hover {
            background: var(--hover-background);
            color: var(--text-color);
        }
        .icon-btn.danger:hover {
            color: var(--danger);
            background: rgba(239, 68, 68, 0.12);
        }
        .icon-btn.confirm {
            color: var(--danger);
            background: rgba(239, 68, 68, 0.18);
        }
        .progress {
            width: 110px;
            height: 4px;
            border-radius: 2px;
            background: rgba(255, 255, 255, 0.1);
            overflow: hidden;
        }
        .progress .fill {
            height: 100%;
            background: var(--accent);
            border-radius: 2px;
            transition: width 0.4s ease;
        }
        .pct {
            font-size: 11px;
            color: var(--text-dim);
            font-family: var(--mono);
            min-width: 34px;
            text-align: right;
        }
        .kbd {
            font-family: var(--mono);
            font-size: 12px;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid var(--button-border);
            border-radius: 4px;
            padding: 3px 10px;
            color: var(--text-color);
            min-width: 90px;
            text-align: center;
            cursor: pointer;
        }
        .kbd.capturing {
            border-color: var(--accent);
            color: var(--accent);
            animation: blink 1.2s ease infinite;
        }
        .kbd.conflict {
            border-color: var(--danger);
            color: var(--danger);
        }
        @keyframes blink {
            50% {
                opacity: 0.4;
            }
        }
        input[type='range'] {
            -webkit-appearance: none;
            appearance: none;
            width: 160px;
            height: 4px;
            border-radius: 2px;
            background: rgba(255, 255, 255, 0.16);
            outline: none;
            cursor: pointer;
        }
        input[type='range']::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: var(--accent);
            cursor: pointer;
            border: none;
        }
        .slider-value {
            font-family: var(--mono);
            font-size: 12px;
            color: var(--text-dim);
            min-width: 38px;
            text-align: right;
        }
        .swatches {
            display: flex;
            gap: 6px;
            align-items: center;
        }
        .swatch {
            width: 20px;
            height: 20px;
            border-radius: 6px;
            border: 2px solid transparent;
            cursor: pointer;
            padding: 0;
        }
        .swatch.on {
            border-color: #fff;
        }
        .swatch.custom {
            background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red);
            overflow: hidden;
            position: relative;
        }
        .swatch.custom input {
            position: absolute;
            inset: -8px;
            opacity: 0;
            cursor: pointer;
            width: 40px;
            height: 40px;
        }
        .status-line {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
        }
        .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            flex: none;
        }
        .dot.ok {
            background: var(--success);
        }
        .dot.warn {
            background: var(--warning);
            animation: blink 1.6s ease infinite;
        }
        .dot.err {
            background: var(--danger);
        }
        .path {
            font-family: var(--mono);
            font-size: 11px;
            color: var(--text-dim);
        }
        .log {
            font-family: var(--mono);
            font-size: 10.5px;
            color: var(--text-dim);
            background: rgba(0, 0, 0, 0.4);
            border-radius: 4px;
            padding: 8px 10px;
            margin-top: 10px;
            max-height: 110px;
            overflow-y: auto;
            line-height: 1.5;
        }
        .btn {
            background: var(--button-background);
            border: 1px solid var(--button-border);
            color: var(--text-color);
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 12px;
            cursor: pointer;
        }
        .btn:hover {
            background: var(--hover-background);
        }
        .btn.danger {
            color: var(--danger);
            border-color: rgba(239, 68, 68, 0.3);
        }
        .btn.danger:hover {
            background: rgba(239, 68, 68, 0.1);
        }
        .note {
            font-size: 11.5px;
            color: var(--text-dim);
            margin-top: 8px;
        }
        code {
            font-family: var(--mono);
            font-size: 11px;
            background: rgba(255, 255, 255, 0.07);
            border-radius: 4px;
            padding: 1px 5px;
        }
        .spin-icon {
            animation: sys-spin 1s linear infinite;
        }
        @keyframes sys-spin {
            to {
                transform: rotate(360deg);
            }
        }
        .vu {
            width: 110px;
            height: 6px;
            border-radius: 3px;
            background: rgba(255, 255, 255, 0.1);
            overflow: hidden;
        }
        .vu-fill {
            height: 100%;
            background: var(--success);
            border-radius: 3px;
            transition: width 0.08s linear;
        }
        .divider {
            height: 1px;
            background: rgba(255, 255, 255, 0.06);
            margin: 6px 0;
        }
    `;

    _switchRow(label, sub, value, onChange) {
        return html`
            <div class="setting">
                <div><span class="label">${label}</span>${sub ? html`<span class="sub">${sub}</span>` : ''}</div>
                <button
                    class="switch"
                    role="switch"
                    aria-checked=${value ? 'true' : 'false'}
                    @click=${() => onChange(!value)}
                ></button>
            </div>
        `;
    }

    render() {
        const s = this.settings;
        if (!s) {
            return html`<div class="wrap"><div class="card">Loading…</div></div>`;
        }
        const gpuOk = this.status?.gpu?.available;
        const recommended = gpuOk ? 'turbo' : 'small.en';
        return html`
            <div class="wrap">
                <div class="card">
                    <div class="section-title">Engine & Device</div>
                    <div class="row" style="margin-bottom:10px">
                        ${[
                            ['whisper', 'Whisper', 'faster-whisper · quick start'],
                            ['whisperx', 'WhisperX', 'word-accurate timestamps'],
                        ].map(([val, label, sub]) => this._radio(s.engine === val, () => this._patch({ engine: val }), label, sub))}
                    </div>
                    <div class="row" style="margin-bottom:10px">
                        ${[
                            ['auto', 'Auto', gpuOk ? 'prefers GPU' : 'CPU'],
                            ['cpu', 'CPU', 'always works'],
                            ['cuda', 'GPU', gpuOk ? 'fast' : 'not detected'],
                        ].map(([val, label, sub]) => this._radio(s.device === val, () => this._patch({ device: val }), label, sub, val === 'cuda' && !gpuOk))}
                    </div>
                    <div class="setting">
                        <div>
                            <span class="label">Compute type</span>
                            <span class="sub">Lower = less VRAM, slightly less accurate</span>
                        </div>
                        <select .value=${s.computeType} @change=${(e) => this._patch({ computeType: e.target.value })}>
                            <option value="auto">Auto</option>
                            <option value="float16" ?disabled=${s.device === 'cpu'}>float16</option>
                            <option value="int8_float16" ?disabled=${s.device === 'cpu'}>int8_float16</option>
                            <option value="int8">int8</option>
                        </select>
                    </div>
                </div>

                <div class="card">
                    <div class="section-title">Models</div>
                    ${(this.catalog || []).map((m) => {
                        const prog = this.modelsProgress[m.key];
                        const downloading = prog && !prog.done;
                        const pct = prog && prog.total ? Math.min(100, Math.round((prog.bytes / prog.total) * 100)) : 0;
                        return html`
                            <div class="model ${s.model === m.key ? 'on' : ''}" style="margin-bottom:6px" @click=${() => this._patch({ model: m.key })}>
                                <div>
                                    <div class="name">${m.name}</div>
                                    <div class="size">${m.downloaded ? fmtSize(m.onDiskMb) : fmtSize(m.sizeMb)}${m.multilingual ? ' · multilingual' : ''}</div>
                                </div>
                                <div class="spacer"></div>
                                ${m.key === recommended ? html`<span class="tag rec">Recommended</span>` : ''}
                                ${s.model === m.key ? html`<span class="tag ok">Active</span>` : ''}
                                ${m.downloaded
                                    ? html`<span class="tag ok">Ready</span>
                                          <button class="icon-btn danger" title="Delete from disk" @click=${(e) => { e.stopPropagation(); this._deleteModel(m.key, e.currentTarget); }}>
                                              <wg-icon name="trash-2" size="13"></wg-icon>
                                          </button>`
                                    : downloading
                                      ? html`<div class="progress"><div class="fill" style="width:${pct}%"></div></div><span class="pct">${pct}%</span>`
                                      : html`<button class="icon-btn" title="Download" @click=${(e) => { e.stopPropagation(); window.wg.invoke('wg:models:download', { key: m.key }); }}>
                                            <wg-icon name="download" size="14"></wg-icon>
                                        </button>`}
                            </div>
                        `;
                    })}
                </div>

                <div class="card">
                    <div class="section-title">Transcription</div>
                    <div class="setting">
                        <div><span class="label">Language</span><span class="sub">Auto-detect costs a little accuracy</span></div>
                        <select .value=${s.language} @change=${(e) => this._patch({ language: e.target.value })}>
                            ${LANGUAGES.map(([code, label]) => html`<option value=${code} ?selected=${s.language === code}>${label}</option>`)}
                        </select>
                    </div>
                    ${this._switchRow('Silero VAD filter', 'Skips silence & noise (Whisper engine)', s.vadFilter, (v) => this._toggle('vadFilter', v))}
                    <div class="setting" style="display:block">
                        <span class="label">Initial prompt</span>
                        <span class="sub">Hint the model with names, jargon, punctuation style…</span>
                        <textarea
                            style="margin-top:6px"
                            placeholder="e.g. WhisperGlass, CTranslate2, PyAnnote"
                            .value=${s.initialPrompt}
                            @change=${(e) => this._patch({ initialPrompt: e.target.value })}
                        ></textarea>
                    </div>
                    ${s.engine === 'whisperx'
                        ? html`
                              <div class="divider"></div>
                              ${this._switchRow('Word alignment', 'Wav2Vec2 forced alignment — accurate word timestamps', s.alignWords, (v) => this._toggle('alignWords', v))}
                              ${this._switchRow('Speaker diarization', 'Labels who said what — needs a free HuggingFace token', s.diarize, (v) => this._toggle('diarize', v))}
                              ${s.diarize
                                  ? html`<div class="setting">
                                        <div>
                                            <span class="label">HuggingFace token</span>
                                            <span class="sub">hf.co/settings/tokens · accept pyannote/segmentation-3.0 + speaker-diarization-community-1 licenses</span>
                                        </div>
                                        <input type="password" placeholder="hf_…" .value=${s.hfToken} @change=${(e) => this._patch({ hfToken: e.target.value.trim() })} style="min-width:170px" />
                                    </div>`
                                  : ''}
                          `
                        : ''}
                </div>

                <div class="card">
                    <div class="section-title">Live transcription</div>
                    ${this._switchRow(
                        'Live preview while recording',
                        'Real-time partials as you speak — the final pass on stop is unchanged',
                        s.liveTranscription.enabled,
                        (v) => this._patch({ liveTranscription: { enabled: v } })
                    )}
                    ${s.liveTranscription.enabled
                        ? html`
                              <div class="setting">
                                  <div>
                                      <span class="label">Live model</span>
                                      <span class="sub">Quick model for partials — smaller = snappier (GPU recommended)</span>
                                  </div>
                                  <select
                                      .value=${s.liveTranscription.model || ''}
                                      @change=${(e) => this._patch({ liveTranscription: { model: e.target.value } })}
                                  >
                                      <option value="">Same as final model</option>
                                      ${(this.catalog || []).map(
                                          (m) => html`
                                              <option value=${m.key} ?selected=${s.liveTranscription.model === m.key}>
                                                  ${m.name}${m.downloaded ? '' : ' (not downloaded)'}
                                              </option>
                                          `
                                      )}
                                  </select>
                              </div>
                              <div class="note">
                                  Words stabilize as they're confirmed across passes; the dim tail is still settling. On stop,
                                  the whole recording is re-transcribed with your full settings.
                              </div>
                          `
                        : ''}
                </div>

                <div class="card">
                    <div class="section-title">Audio</div>
                    <div class="setting">
                        <div>
                            <span class="label">Microphone</span>
                            <span class="sub">Input device used for recordings</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:6px">
                            <select
                                .value=${s.micDeviceId || ''}
                                @change=${(e) => {
                                    const device = this._devices.find((d) => d.deviceId === e.target.value);
                                    this._patch({
                                        micDeviceId: e.target.value,
                                        micLabel: device ? device.label : '',
                                    });
                                }}
                            >
                                <option value="">System default</option>
                                ${this._devices.map(
                                    (d) => html`<option value=${d.deviceId} ?selected=${s.micDeviceId === d.deviceId}>
                                        ${d.label}${d.deviceId === s.micDeviceId ? ' ✓' : ''}
                                    </option>`
                                )}
                            </select>
                            <button
                                class="icon-btn"
                                title="Refresh device list"
                                ?disabled=${this._devicesLoading}
                                @click=${() => this._refreshDevices()}
                            >
                                <wg-icon name="refresh-cw" size="13" class=${this._devicesLoading ? 'spin-icon' : ''}></wg-icon>
                            </button>
                        </div>
                    </div>
                    <div class="setting">
                        <div>
                            <span class="label">Signal test</span>
                            <span class="sub">${this._testing
                                ? html`Capturing <b>${this._testLabel || 'device'}</b> — speak into the mic${this._testLevel > 0.004 ? ' ✓ signal' : ' …no signal yet'}`
                                : 'Check which mic actually picks up sound before recording'}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px">
                            ${this._testing
                                ? html`<div class="vu"><div class="vu-fill" style="width:${Math.round(micLevelToHeight(this._testLevel) * 100)}%"></div></div>`
                                : ''}
                            <button class="btn" @click=${() => this._testMic()}>
                                <wg-icon name="volume-2" size="12"></wg-icon>
                                ${this._testing ? 'Stop test' : 'Test'}
                            </button>
                        </div>
                    </div>
                    ${this._devices.length === 0
                        ? html`<div class="note">No named devices found yet — labels appear after you grant mic access (record once or run the test).</div>`
                        : ''}
                </div>

                <div class="card">
                    <div class="section-title">Keybinds</div>
                    ${KEYBIND_ACTIONS.map(([action, label]) => {
                        const acc = s.keybinds?.[action] || '';
                        const conflict = Object.entries(s.keybinds || {}).some(([a, v]) => a !== action && v === acc);
                        return html`
                            <div class="setting">
                                <span class="label">${label}</span>
                                <div class="kbd ${this._capturing === action ? 'capturing' : ''} ${conflict ? 'conflict' : ''}"
                                    @click=${() => (this._capturing === action ? this._stopCapture() : this._startCapture(action))}>
                                    ${this._capturing === action ? 'press keys…' : acc || 'unset'}
                                </div>
                            </div>
                        `;
                    })}
                    <div class="note"><button class="btn" @click=${() => this._patch({ keybinds: { ...DEFAULT_KEYBINDS } })}>Reset all keybinds</button></div>
                    <div class="divider"></div>
                    <div class="setting" style="display:block">
                        <span class="label">System keybind (recommended on GNOME Wayland)</span>
                        <span class="sub">Compositor-level toggle — fires even when another app has focus (the in-app grab cannot)</span>
                        ${this.keybindInfo?.gnome
                            ? html`
                                  <div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap">
                                      <div
                                          class="kbd ${this._capturing === 'systemToggle' ? 'capturing' : ''}"
                                          @click=${() =>
                                              this._capturing === 'systemToggle'
                                                  ? this._stopCapture()
                                                  : this._startCapture('systemToggle')}
                                      >
                                          ${this._capturing === 'systemToggle' ? 'press keys…' : this._systemCombo}
                                      </div>
                                      ${this.keybindInfo?.installed
                                          ? html`<span class="tag ok">Installed</span>
                                                <button class="btn" ?disabled=${this._sysBusy} @click=${() => this._uninstallSystemKeybind()}>Remove</button>`
                                          : html`<button class="btn" ?disabled=${this._sysBusy} @click=${() => this._installSystemKeybind()}>
                                                <wg-icon name="download" size="12"></wg-icon> Install
                                            </button>`}
                                  </div>
                                  ${this.keybindInfo?.installed
                                      ? html`<div class="note" style="color:var(--success)">Active — the in-app "Show / hide" grab is disabled while this is installed.</div>`
                                      : html`<div class="note">Runs a tiny launcher (~/.local/bin/whisperglass-toggle) registered via gsettings. Your other custom keybindings are preserved.</div>`}
                                  ${this.keybindInfo?.error ? html`<div class="note" style="color:var(--danger)">${this.keybindInfo.error}</div>` : ''}
                              `
                            : html`<div class="note">Not on GNOME — you can set a shortcut manually in your desktop settings that runs the app with <code>--toggle</code> (see README → System keybind).</div>`}
                    </div>
                </div>

                <div class="card">
                    <div class="section-title">Behavior</div>
                    ${this._switchRow('Auto-copy to clipboard', 'Copies each transcription when finished', s.autoCopy, (v) => this._toggle('autoCopy', v))}
                    ${this._switchRow('System notifications', 'Desktop notification when copied', s.systemNotifications, (v) => this._toggle('systemNotifications', v))}
                    ${this._switchRow('Keep audio files', 'Store recordings in ~/.local/share/whisperglass/audio', s.keepAudio, (v) => this._toggle('keepAudio', v))}
                    <div class="setting">
                        <div><span class="label">Unload model when idle</span><span class="sub">Frees GPU memory for games / other apps</span></div>
                        <select .value=${String(s.backend.idleUnloadMin)} @change=${(e) => this._patch({ backend: { idleUnloadMin: Number(e.target.value) } })}>
                            <option value="0">Never</option>
                            <option value="5">After 5 min</option>
                            <option value="15">After 15 min</option>
                            <option value="30">After 30 min</option>
                        </select>
                    </div>
                </div>

                <div class="card">
                    <div class="section-title">Appearance</div>
                    <div class="setting">
                        <span class="label">Background transparency</span>
                        <div style="display:flex;align-items:center;gap:8px">
                            <input type="range" min="0.4" max="1" step="0.01" .value=${String(s.appearance.transparency)}
                                @input=${(e) => this._patch({ appearance: { transparency: Number(e.target.value) } })} />
                            <span class="slider-value">${Math.round(s.appearance.transparency * 100)}%</span>
                        </div>
                    </div>
                    <div class="setting">
                        <span class="label">Transcript font size</span>
                        <div style="display:flex;align-items:center;gap:8px">
                            <input type="range" min="14" max="28" step="1" .value=${String(s.appearance.fontSize)}
                                @input=${(e) => this._patch({ appearance: { fontSize: Number(e.target.value) } })} />
                            <span class="slider-value">${s.appearance.fontSize}px</span>
                        </div>
                    </div>
                    ${this._switchRow('Compact mode', 'Tighter spacing, smaller text', s.appearance.compact, (v) => this._patch({ appearance: { compact: v } }))}
                    ${this._switchRow('Sessions panel visible', s.appearance.sidebarVisible, (v) => this._patch({ appearance: { sidebarVisible: v } }))}
                    ${this._switchRow('Tray icon', 'Menu in the top bar — always-available restore path', s.appearance.showTray, (v) => this._patch({ appearance: { showTray: v } }))}
                    <div class="setting">
                        <span class="label">Accent color</span>
                        <div class="swatches">
                            ${ACCENTS.map((c) => html`<button class="swatch ${s.appearance.accent === c ? 'on' : ''}" style="background:${c}" @click=${() => this._patch({ appearance: { accent: c } })}></button>`)}
                            <span class="swatch custom ${ACCENTS.includes(s.appearance.accent) ? '' : 'on'}">
                                <input type="color" .value=${s.appearance.accent} @input=${(e) => this._patch({ appearance: { accent: e.target.value } })} />
                            </span>
                        </div>
                    </div>
                    ${this._switchRow('Native Wayland', 'Experimental — needs restart. Off = XWayland (recommended for transparency)', s.backend.nativeWayland, (v) => this._patch({ backend: { nativeWayland: v } }))}
                </div>

                <div class="card">
                    <div class="section-title">Backend</div>
                    <div class="status-line">
                        <span class="dot ${this.status?.phase === 'ready' ? 'ok' : this.status?.phase === 'error' ? 'err' : 'warn'}"></span>
                        ${this.status?.phase === 'ready'
                            ? html`Ready — ${this.status?.gpu?.available ? html`${this.status.gpu.name || 'GPU'} (${Math.round((this.status.gpu.vramFreeMb || 0) / 1024)} GB free)` : 'CPU mode'}`
                            : html`${this.status?.message || '…'} ${this.status?.detail || ''}`}
                    </div>
                    <div class="note path">~/.local/share/whisperglass</div>
                    <div class="row" style="margin-top:8px">
                        <button class="btn" @click=${() => window.wg.invoke('wg:backend:retry')}>
                            <wg-icon name="refresh-cw" size="12"></wg-icon> Reinstall backend
                        </button>
                        <button class="btn danger" @click=${() => window.wg.invoke('wg:app:quit')}>
                            <wg-icon name="x" size="12"></wg-icon> Quit
                        </button>
                    </div>
                    ${this.backendLog?.length ? html`<div class="log">${this.backendLog.map((l) => html`<div>${l}</div>`)}</div>` : ''}
                </div>

                <div class="card">
                    <div class="section-title">Diagnostics</div>
                    ${this._switchRow(
                        'Verbose logging',
                        'Detailed capture & transcription logs — asks to restart, applies from next launch',
                        s.debug.verboseLogging,
                        (v) => this._patch({ debug: { verboseLogging: v } })
                    )}
                    <div class="note path">~/.local/share/whisperglass/whisperglass.log</div>
                    <div class="row" style="margin-top:8px">
                        <button class="btn" @click=${() => window.wg.invoke('wg:debug:open-log')}>
                            <wg-icon name="external-link" size="12"></wg-icon> Open log
                        </button>
                        <button class="btn" @click=${() => this._copyLog()}>
                            <wg-icon name="copy" size="12"></wg-icon> Copy last 50 lines
                        </button>
                        <button class="btn" @click=${() => this._loadLogTail()}>
                            <wg-icon name="refresh-cw" size="12"></wg-icon> Tail
                        </button>
                    </div>
                    ${this._logTail
                        ? html`<div class="log">${this._logTail.split('\n').map((l) => html`<div>${l}</div>`)}</div>`
                        : ''}
                </div>
            </div>
        `;
    }

    _radio(on, onClick, label, sub, disabled = false) {
        return html`
            <div class="radio ${on ? 'on' : ''}" style=${disabled ? 'opacity:0.4;pointer-events:none' : ''} @click=${onClick}>
                <span class="mark"></span>
                <div>
                    <div class="rl">${label}</div>
                    <div class="rs">${sub}</div>
                </div>
            </div>
        `;
    }

    async _deleteModel(key, btn) {
        if (btn.classList.contains('confirm')) {
            await window.wg.invoke('wg:models:delete', { key });
            toast('Model deleted', 'info');
            return;
        }
        btn.classList.add('confirm');
        setTimeout(() => btn.classList.remove('confirm'), 2500);
    }
}

customElements.define('settings-view', SettingsView);
