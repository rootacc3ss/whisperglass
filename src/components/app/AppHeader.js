import { html, css, LitElement } from '../../assets/lit-core.min.js';
import '../common/wg-icon.js';
import { micState, onMicUpdate } from '../../utils/mic.js';

class AppHeader extends LitElement {
    static properties = {
        status: { type: Object },
        settings: { type: Object },
        view: { type: String },
        recording: { type: Boolean },
        busy: { type: Boolean },
        _elapsed: { state: true },
    };

    constructor() {
        super();
        this.status = null;
        this.settings = null;
        this.view = 'main';
        this.recording = false;
        this.busy = false;
        this._elapsed = 0;
        this._timer = null;
        this._unsubMic = null;
    }

    connectedCallback() {
        super.connectedCallback();
        this._unsubMic = onMicUpdate(() => {
            if (micState.capturing) this._elapsed = (Date.now() - micState.startedAt) / 1000;
        });
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._unsubMic) this._unsubMic();
        this._stopTimer();
    }

    updated(changed) {
        if (changed.has('recording')) {
            if (this.recording) this._startTimer();
            else {
                this._stopTimer();
                this._elapsed = 0;
            }
        }
    }

    _startTimer() {
        this._stopTimer();
        this._timer = setInterval(() => {
            this._elapsed = (Date.now() - micState.startedAt) / 1000;
        }, 500);
    }

    _stopTimer() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    static styles = css`
        :host {
            display: block;
            height: 40px;
            background: var(--header-background);
            -webkit-app-region: drag;
        }
        .bar {
            display: flex;
            align-items: center;
            gap: 8px;
            height: 40px;
            padding: 0 8px 0 12px;
            -webkit-app-region: drag;
        }
        .bar > * {
            -webkit-app-region: no-drag;
        }
        .wordmark {
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 0.2px;
            color: var(--text-color);
            display: flex;
            align-items: center;
            gap: 7px;
            user-select: none;
            -webkit-app-region: drag;
        }
        .wordmark .gem {
            width: 7px;
            height: 7px;
            border-radius: 2px;
            background: var(--accent);
            flex: none;
            transform: rotate(45deg);
        }
        .icon-btn {
            background: none;
            border: none;
            color: var(--text-dim);
            width: 28px;
            height: 28px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            padding: 0;
        }
        .icon-btn:hover {
            background: var(--hover-background);
            color: var(--text-color);
        }
        .icon-btn.active {
            color: var(--accent);
        }
        .pill {
            margin: 0 auto;
            display: flex;
            align-items: center;
            gap: 7px;
            font-size: 12px;
            color: var(--text-dim);
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid var(--button-border);
            border-radius: 999px;
            padding: 3px 12px;
            max-width: 46%;
            white-space: nowrap;
            overflow: hidden;
            user-select: none;
            -webkit-app-region: drag;
        }
        .pill .text {
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            flex: none;
            background: var(--text-dim);
        }
        .dot.ready {
            background: var(--success);
        }
        .dot.install,
        .dot.starting {
            background: var(--warning);
            animation: blink 1.6s ease infinite;
        }
        .dot.error {
            background: var(--danger);
        }
        .dot.rec {
            background: var(--danger);
            animation: blink 1.1s ease infinite;
        }
        .dot.busy {
            background: var(--accent);
            animation: blink 1.1s ease infinite;
        }
        .pill.rec {
            color: var(--danger);
        }
        .pill.busy {
            color: var(--text-color);
        }
        @keyframes blink {
            0%,
            100% {
                opacity: 1;
            }
            50% {
                opacity: 0.35;
            }
        }
    `;

    _pill() {
        const st = this.status || { phase: 'boot' };
        if (this.recording) {
            const m = Math.floor(this._elapsed / 60);
            const s = Math.floor(this._elapsed % 60);
            return html`<div class="pill rec">
                <span class="dot rec"></span><span class="text">Recording · ${m}:${String(s).padStart(2, '0')}</span>
            </div>`;
        }
        if (st.phase === 'busy' || this.busy) {
            return html`<div class="pill busy"><span class="dot busy"></span><span class="text">Transcribing…</span></div>`;
        }
        if (st.phase === 'installing') {
            return html`<div class="pill"><span class="dot install"></span><span class="text">Setting up AI backend…</span></div>`;
        }
        if (st.phase === 'starting') {
            return html`<div class="pill"><span class="dot starting"></span><span class="text">Starting service…</span></div>`;
        }
        if (st.phase === 'boot') {
            return html`<div class="pill"><span class="dot install"></span><span class="text">Booting…</span></div>`;
        }
        if (st.phase === 'error') {
            return html`<div class="pill"><span class="dot error"></span><span class="text">Backend error</span></div>`;
        }
        const model = (st.loadedModel || this.settings?.model || '').replace(/^.*__/, '');
        const device = st.gpu?.available && this.settings?.device !== 'cpu' ? (this.settings?.device === 'cuda' ? 'gpu' : 'gpu?') : 'cpu';
        return html`<div class="pill">
            <span class="dot ready"></span><span class="text">${model ? `${model} · ${device}` : 'no model'}</span>
        </div>`;
    }

    render() {
        return html`
            <div class="bar">
                <div class="wordmark"><span class="gem"></span>WhisperGlass</div>
                ${this._pill()}
                ${this.view === 'main'
                    ? html`<button
                          class="icon-btn"
                          title="Toggle sessions panel"
                          @click=${() => window.wg.invoke('wg:window:toggle-sidebar')}
                      >
                          <wg-icon name="panel-left" size="15"></wg-icon>
                      </button>`
                    : ''}
                <button
                    class="icon-btn ${this.view === 'settings' ? 'active' : ''}"
                    title="Settings"
                    @click=${() => this.dispatchEvent(new CustomEvent('toggle-settings', { bubbles: true, composed: true }))}
                >
                    <wg-icon name="settings" size="15"></wg-icon>
                </button>
                <button
                    class="icon-btn"
                    title="Hide (Ctrl+\)"
                    @click=${() => window.wg.send('wg:window-hide')}
                >
                    <wg-icon name="x" size="15"></wg-icon>
                </button>
            </div>
        `;
    }
}

customElements.define('app-header', AppHeader);
