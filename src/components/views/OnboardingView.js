import { html, css, LitElement } from '../../assets/lit-core.min.js';
import '../common/wg-icon.js';
import { toast } from '../common/wg-toast.js';

class OnboardingView extends LitElement {
    static properties = {
        settings: { type: Object },
        status: { type: Object },
        catalog: { type: Array },
        modelsProgress: { type: Object },
        backendLog: { type: Array },
    };

    constructor() {
        super();
        this.settings = null;
        this.status = null;
        this.catalog = [];
        this.modelsProgress = {};
        this.backendLog = [];
    }

    _patch(patch) {
        this.dispatchEvent(new CustomEvent('settings-patch', { detail: patch, bubbles: true, composed: true }));
    }

    async _download(key) {
        await window.wg.invoke('wg:models:download', { key });
    }

    _finish() {
        window.wg.invoke('wg:app:finish-onboarding');
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
            padding: 20px 16px 28px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .hero {
            text-align: center;
            padding: 10px 0 4px;
            user-select: none;
        }
        .hero h1 {
            font-size: 26px;
            font-weight: 700;
            margin: 0 0 6px;
            letter-spacing: -0.3px;
        }
        .hero p {
            color: var(--text-dim);
            margin: 0;
            font-size: 14px;
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
        .status-line {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            color: var(--text-color);
        }
        .status-line .msg {
            color: var(--text-dim);
            font-size: 12px;
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
        @keyframes blink {
            50% {
                opacity: 0.35;
            }
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
        .row {
            display: flex;
            gap: 8px;
        }
        .radio {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 9px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--button-border);
            border-radius: 8px;
            padding: 10px 12px;
            cursor: pointer;
            user-select: none;
        }
        .radio:hover {
            background: var(--hover-background);
        }
        .radio.on {
            border-color: var(--accent);
            background: var(--accent-dim);
        }
        .radio .mark {
            width: 14px;
            height: 14px;
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
        .radio .label {
            font-size: 13px;
            font-weight: 500;
        }
        .radio .sub {
            font-size: 11px;
            color: var(--text-dim);
        }
        .models {
            display: flex;
            flex-direction: column;
            gap: 6px;
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
            background: var(--accent-dim);
            color: var(--text-color);
            border-radius: 4px;
            padding: 2px 6px;
        }
        .tag.ok {
            background: rgba(52, 211, 153, 0.15);
            color: var(--success);
        }
        .dl-btn {
            background: var(--button-background);
            border: 1px solid var(--button-border);
            color: var(--text-color);
            border-radius: 6px;
            padding: 4px 10px;
            font-size: 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .dl-btn:hover {
            background: var(--hover-background);
        }
        .progress {
            flex: 1;
            max-width: 130px;
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
        .keys {
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
            font-size: 12.5px;
            color: var(--text-dim);
        }
        .keys kbd {
            font-family: var(--mono);
            font-size: 11px;
            background: rgba(255, 255, 255, 0.07);
            border: 1px solid var(--button-border);
            border-radius: 4px;
            padding: 2px 7px;
            color: var(--text-color);
            margin-left: 6px;
        }
        .actions {
            display: flex;
            gap: 10px;
            align-items: center;
            justify-content: center;
            padding-top: 4px;
        }
        .primary {
            background: #fff;
            color: #000;
            font-weight: 600;
            border: none;
            border-radius: 8px;
            padding: 9px 22px;
            font-size: 13px;
            cursor: pointer;
        }
        .primary:hover {
            opacity: 0.9;
        }
        .ghost {
            background: none;
            border: none;
            color: var(--text-dim);
            font-size: 12px;
            cursor: pointer;
            padding: 6px;
        }
        .ghost:hover {
            color: var(--text-color);
            text-decoration: underline;
        }
        .note {
            font-size: 11.5px;
            color: var(--text-dim);
            margin-top: 8px;
        }
    `;

    _backendCard() {
        const st = this.status || { phase: 'boot' };
        const ok = st.phase === 'ready' || st.phase === 'busy';
        const err = st.phase === 'error';
        return html`
            <div class="card">
                <div class="section-title">1 · AI Backend</div>
                <div class="status-line">
                    <span class="dot ${ok ? 'ok' : err ? 'err' : 'warn'}"></span>
                    ${ok
                        ? html`Ready${st.gpu?.available ? html` — <b>${st.gpu.name || 'GPU'}</b> detected` : ' — CPU mode'}`
                        : err
                          ? html`${st.message} <span class="msg">${st.detail}</span>`
                          : html`${st.message || 'Working…'} <span class="msg">(one-time setup, ~2 GB download)</span>`}
                    ${err
                        ? html`<button
                              class="dl-btn"
                              @click=${() => window.wg.invoke('wg:backend:retry')}
                              style="margin-left:8px"
                          >
                              <wg-icon name="refresh-cw" size="12"></wg-icon> Retry
                          </button>`
                        : ''}
                </div>
                ${this.backendLog.length
                    ? html`<div class="log">${this.backendLog.map((l) => html`<div>${l}</div>`)}</div>`
                    : ''}
            </div>
        `;
    }

    _deviceCard() {
        const settings = this.settings;
        if (!settings) return html``;
        const gpuOk = this.status?.gpu?.available;
        const recommended = gpuOk ? 'turbo' : 'small.en';
        const models = this.catalog || [];
        return html`
            <div class="card">
                <div class="section-title">2 · Device & Model</div>
                <div class="row" style="margin-bottom:10px">
                    ${['auto', 'cpu', 'cuda'].map((d) => {
                        const disabled = d === 'cuda' && !gpuOk;
                        return html`
                            <div
                                class="radio ${settings.device === d ? 'on' : ''}"
                                style=${disabled ? 'opacity:0.4;pointer-events:none' : ''}
                                @click=${() => this._patch({ device: d })}
                            >
                                <span class="mark"></span>
                                <div>
                                    <div class="label">${d === 'auto' ? 'Auto' : d === 'cpu' ? 'CPU' : 'GPU'}</div>
                                    <div class="sub">
                                        ${d === 'auto' ? 'GPU if available' : d === 'cpu' ? 'slow, safe' : gpuOk ? 'fast' : 'not detected'}
                                    </div>
                                </div>
                            </div>
                        `;
                    })}
                </div>
                <div class="models">
                    ${models.slice(0, 7).map((m) => {
                        const prog = this.modelsProgress[m.key];
                        const downloading = prog && !prog.done;
                        const pct = prog && prog.total ? Math.min(100, Math.round((prog.bytes / prog.total) * 100)) : 0;
                        return html`
                            <div
                                class="model ${settings.model === m.key ? 'on' : ''}"
                                @click=${() => this._patch({ model: m.key })}
                            >
                                <div>
                                    <div class="name">${m.name}</div>
                                    <div class="size">${m.sizeMb >= 1000 ? `${(m.sizeMb / 1000).toFixed(1)} GB` : `${m.sizeMb} MB`}${m.multilingual ? ' · multilingual' : ''}</div>
                                </div>
                                <div class="spacer"></div>
                                ${m.key === recommended ? html`<span class="tag">Recommended</span>` : ''}
                                ${m.downloaded
                                    ? html`<span class="tag ok">Ready</span>`
                                    : downloading
                                      ? html`
                                            <div class="progress">
                                                <div class="fill" style="width:${pct}%"></div>
                                            </div>
                                            <span class="pct">${pct}%</span>
                                        `
                                      : html`
                                            <button
                                                class="dl-btn"
                                                @click=${(e) => {
                                                    e.stopPropagation();
                                                    this._download(m.key);
                                                }}
                                            >
                                                <wg-icon name="download" size="12"></wg-icon> Download
                                            </button>
                                        `}
                            </div>
                        `;
                    })}
                </div>
                <div class="note">Downloads are cached in ~/.local/share/whisperglass/models — one time each.</div>
            </div>
        `;
    }

    _finishCard() {
        const kb = this.settings?.keybinds || {};
        const readyModel = (this.catalog || []).some((m) => m.downloaded && m.key === this.settings?.model);
        return html`
            <div class="card">
                <div class="section-title">3 · You're set</div>
                <div class="keys">
                    <span>Record<kbd>${kb.toggleRecording || ''}</kbd></span>
                    <span>Hide / show<kbd>${kb.toggleVisibility || ''}</kbd></span>
                    <span>New session<kbd>${kb.newSession || ''}</kbd></span>
                </div>
                <div class="note">
                    Every recording lands in the current session and is copied to your clipboard automatically. Click
                    any transcription to edit & re-copy.
                </div>
                <div class="actions">
                    <button class="primary" @click=${() => this._finish()}>
                        ${readyModel ? 'Start using WhisperGlass' : 'Skip model for now'}
                    </button>
                </div>
            </div>
        `;
    }

    render() {
        return html`
            <div class="wrap">
                <div class="hero">
                    <h1>WhisperGlass</h1>
                    <p>Local speech-to-text with Whisper & WhisperX — private, transparent, always on top.</p>
                </div>
                ${this._backendCard()} ${this._deviceCard()} ${this._finishCard()}
            </div>
        `;
    }
}

customElements.define('onboarding-view', OnboardingView);
