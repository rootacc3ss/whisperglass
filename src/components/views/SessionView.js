import { html, css, LitElement } from '../../assets/lit-core.min.js';
import '../common/wg-icon.js';
import './transcription-entry.js';
import { micState, onMicUpdate, micLevelToHeight } from '../../utils/mic.js';
import { toast } from '../common/wg-toast.js';

function fmtTime(totalSec) {
    const s = Math.max(0, Math.floor(totalSec));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
}

class SessionView extends LitElement {
    static properties = {
        session: { type: Object },
        settings: { type: Object },
        status: { type: Object },
        recording: { type: Boolean },
        lastResultId: { type: String },
        _levels: { state: true },
        _elapsed: { state: true },
        _busy: { state: true },
        _livePartial: { state: true },
    };

    constructor() {
        super();
        this.session = null;
        this.settings = null;
        this.status = null;
        this.recording = false;
        this.lastResultId = '';
        this._levels = [];
        this._elapsed = 0;
        this._busy = false;
        this._livePartial = { confirmed: '', partial: '' };
        this._deviceLabel = '';
        this._timer = null;
        this._unsubMic = null;
    }

    connectedCallback() {
        super.connectedCallback();
        this._unsubMic = onMicUpdate(() => {
            this._levels = [...micState.levels];
            this._deviceLabel = micState.deviceLabel;
        });
        const wg = window.wg;
        this._unsubEvents = [
            wg.on('wg:transcribe:result', () => (this._busy = false)),
            wg.on('wg:transcribe:error', () => (this._busy = false)),
            wg.on('wg:live-partial', (p) => {
                this._livePartial = p || { confirmed: '', partial: '' };
            }),
            wg.on('wg:rec-cancelled', () => {
                this._livePartial = { confirmed: '', partial: '' };
            }),
        ];
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._unsubMic) this._unsubMic();
        for (const unsub of this._unsubEvents || []) unsub();
        this._stopTimer();
    }

    updated(changed) {
        if (changed.has('recording')) {
            if (this.recording) this._startTimer();
            else this._stopTimer();
        }
        if (this.session && (changed.has('session') || changed.has('lastResultId'))) {
            this._scrollToBottom();
        }
    }

    _startTimer() {
        this._elapsed = 0;
        this._stopTimer();
        this._timer = setInterval(() => {
            this._elapsed = (Date.now() - micState.startedAt) / 1000;
        }, 400);
    }

    _stopTimer() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    async _scrollToBottom() {
        await this.updateComplete;
        const scroller = this.renderRoot.querySelector('.scroll');
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
    }

    async _toggleRecord() {
        const wg = window.wg;
        if (this.recording) {
            const res = await wg.invoke('wg:rec:stop');
            if (res && res.ok) this._busy = true;
        } else {
            const res = await wg.invoke('wg:rec:start');
            if (res && res.ok === false && res.error) toast(res.error, 'error');
        }
    }

    async _cancelRecord() {
        await window.wg.invoke('wg:rec:cancel');
    }

    _handleEntrySave(e) {
        const detail = e.detail;
        this.dispatchEvent(new CustomEvent('entry-save', { detail: { ...detail, sessionId: this.session?.id }, bubbles: true, composed: true }));
    }

    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            height: 100%;
            min-width: 0;
            flex: 1;
        }
        .scroll {
            flex: 1;
            overflow-y: auto;
            padding: 12px 14px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            scroll-behavior: smooth;
        }
        .empty {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 10px;
            color: var(--text-dim);
            user-select: none;
        }
        .empty .big {
            width: 64px;
            height: 64px;
            border-radius: 50%;
            background: var(--card-background);
            border: 1px solid var(--button-border);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-dim);
        }
        .empty .hint {
            font-size: 13px;
        }
        .empty kbd {
            font-family: var(--mono);
            font-size: 11px;
            background: rgba(255, 255, 255, 0.07);
            border: 1px solid var(--button-border);
            border-radius: 4px;
            padding: 2px 7px;
            color: var(--text-color);
        }
        .bar {
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 10px 14px 12px;
            border-top: 1px solid var(--border-color);
            background: rgba(0, 0, 0, 0.25);
        }
        .levels {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 2px;
            height: 28px;
            overflow: hidden;
        }
        .levels .lv {
            flex: 1;
            min-width: 2px;
            max-width: 6px;
            height: 3px;
            border-radius: 1px;
            background: rgba(255, 255, 255, 0.14);
            transition: height 0.22s linear, background 0.22s linear;
        }
        .recording .levels .lv.on {
            background: var(--danger);
        }
        .levels .lv.on {
            background: var(--accent);
        }
        .timer {
            font-family: var(--mono);
            font-size: 13px;
            color: var(--text-dim);
            min-width: 44px;
            text-align: center;
            font-variant-numeric: tabular-nums;
        }
        .recording .timer {
            color: var(--danger);
        }
        .device-label {
            font-size: 11px;
            color: var(--text-dim);
            max-width: 120px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            user-select: none;
        }
        .fab {
            width: 46px;
            height: 46px;
            border-radius: 50%;
            border: none;
            background: var(--accent);
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            flex: none;
            transition: transform 0.12s ease, background 0.2s ease;
        }
        .fab:hover {
            transform: scale(1.06);
        }
        .fab:active {
            transform: scale(0.96);
        }
        .fab.rec {
            background: var(--danger);
            animation: pulse 1.4s ease infinite;
        }
        @keyframes pulse {
            0%,
            100% {
                box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.45);
            }
            50% {
                box-shadow: 0 0 0 8px rgba(239, 68, 68, 0);
            }
        }
        .cancel-btn {
            width: 34px;
            height: 34px;
            border-radius: 50%;
            border: 1px solid var(--button-border);
            background: none;
            color: var(--text-dim);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            flex: none;
        }
        .cancel-btn:hover {
            color: var(--danger);
            border-color: rgba(239, 68, 68, 0.4);
            background: rgba(239, 68, 68, 0.08);
        }
        .status-line {
            font-size: 12px;
            color: var(--text-dim);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .live-card {
            display: flex;
            align-items: baseline;
            gap: 8px;
            margin: 0 14px 6px;
            padding: 8px 12px;
            background: var(--card-background);
            border: 1px solid var(--button-border);
            border-radius: 8px;
            font-size: 13px;
            line-height: 1.5;
            max-height: 76px;
            overflow: hidden;
            -webkit-mask-image: linear-gradient(to bottom, #000 70%, transparent);
            mask-image: linear-gradient(to bottom, #000 70%, transparent);
        }
        .live-badge {
            flex: none;
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.8px;
            color: var(--danger);
        }
        .live-badge .dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--danger);
            animation: live-blink 1.3s ease infinite;
        }
        @keyframes live-blink {
            50% {
                opacity: 0.25;
            }
        }
        .live-confirmed {
            color: var(--text-color);
        }
        .live-partial {
            color: var(--text-dim);
            font-style: italic;
        }
        .live-empty {
            color: var(--text-dim);
            font-style: italic;
        }
        wg-icon.spin {
            animation: local-spin 1s linear infinite;
        }
        @keyframes local-spin {
            to {
                transform: rotate(360deg);
            }
        }
    `;

    _renderBottom() {
        const levels = this._levels;
        const onCount = this.recording ? levels.length : 0;
        return html`
            <div class="bar ${this.recording ? 'recording' : ''}">
                ${this.recording
                    ? html`<button class="cancel-btn" title="Discard recording" @click=${() => this._cancelRecord()}>
                              <wg-icon name="x" size="15"></wg-icon>
                          </button>`
                    : ''}
                <div class="levels">
                    ${Array.from({ length: 40 }, (_, i) => {
                        const idx = levels.length - 40 + i;
                        const rms = idx >= 0 ? levels[idx] : 0;
                        const h = 3 + Math.round(micLevelToHeight(rms) * 24);
                        return html`<div
                            class="lv ${idx >= 0 && rms > 0.004 ? 'on' : ''}"
                            style=${idx >= 0 && rms > 0.004 ? `height:${h}px` : ''}
                        ></div>`;
                    })}
                </div>
                ${this.recording
                    ? html`<span class="timer">${fmtTime(this._elapsed)}</span>
                          ${this._deviceLabel
                              ? html`<span class="device-label" title=${this._deviceLabel}>${this._deviceLabel}</span>`
                              : ''}`
                    : this._busy
                      ? html`<span class="status-line"><wg-icon class="spin" name="spinner" size="14"></wg-icon> transcribing…</span>`
                      : ''}
                <button
                    class="fab ${this.recording ? 'rec' : ''}"
                    title=${this.recording ? 'Stop & transcribe' : 'Record'}
                    @click=${() => this._toggleRecord()}
                >
                    <wg-icon name=${this.recording ? 'stop' : 'mic'} size=${this.recording ? 20 : 22}></wg-icon>
                </button>
            </div>
        `;
    }

    render() {
        const entries = this.session?.entries || [];
        const hasModel = this.settings && this.settings.model;
        const liveOn = this.recording && this.settings?.liveTranscription?.enabled;
        const lp = this._livePartial || { confirmed: '', partial: '' };
        return html`
            <div class="scroll">
                ${entries.length === 0
                    ? html`
                          <div class="empty">
                              <div class="big"><wg-icon name="mic" size="26"></wg-icon></div>
                              <div class="hint">
                                  ${this.settings
                                      ? html`Press
                                        <kbd>${this.settings.keybinds?.toggleRecording || ''}</kbd>
                                        or click the mic to record`
                                      : 'Loading…'}
                              </div>
                              ${!hasModel ? html`<div class="hint">No model selected — pick one in Settings → Models</div>` : ''}
                          </div>
                      `
                    : entries.map(
                          (entry) => html`
                              <transcription-entry
                                  .entry=${entry}
                                  .animate=${entry.id === this.lastResultId}
                                  @entry-save=${(e) => this._handleEntrySave(e)}
                                  @entry-copy=${(e) =>
                                      this.dispatchEvent(
                                          new CustomEvent('entry-copy', { detail: e.detail, bubbles: true, composed: true })
                                      )}
                                  @entry-delete=${(e) =>
                                      this.dispatchEvent(
                                          new CustomEvent('entry-delete', { detail: e.detail, bubbles: true, composed: true })
                                      )}
                              ></transcription-entry>
                          `
                      )}
            </div>
            ${liveOn
                ? html`
                      <div class="live-card">
                          <span class="live-badge"><span class="dot"></span>LIVE</span>
                          ${lp.confirmed || lp.partial
                              ? html`<span class="live-confirmed">${lp.confirmed}</span>
                                    ${lp.partial ? html`<span class="live-partial">${lp.partial}</span>` : ''}`
                              : html`<span class="live-empty">listening…</span>`}
                      </div>
                  `
                : ''}
            ${this._renderBottom()}
        `;
    }
}

customElements.define('session-view', SessionView);
