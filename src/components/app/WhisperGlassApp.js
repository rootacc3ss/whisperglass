import { html, css, LitElement } from '../../assets/lit-core.min.js';
import './AppHeader.js';
import '../common/wg-toast.js';
import '../common/session-sidebar.js';
import '../views/SessionView.js';
import '../views/SettingsView.js';
import '../views/OnboardingView.js';
import { toast } from '../common/wg-toast.js';

function hexToRgba(hex, alpha) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return `rgba(0, 122, 255, ${alpha})`;
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

class WhisperGlassApp extends LitElement {
    static properties = {
        _state: { state: true },
        _view: { state: true },
        _recording: { state: true },
        _busy: { state: true },
        _lastResultId: { state: true },
        _backendLog: { state: true },
        _modelsProgress: { state: true },
    };

    constructor() {
        super();
        this._state = null;
        this._view = 'main';
        this._recording = false;
        this._busy = false;
        this._lastResultId = '';
        this._backendLog = [];
        this._modelsProgress = {};
        this._subs = [];
        this._escapeHandler = (e) => {
            if (e.key === 'Escape' && this._view === 'settings') this._view = 'main';
        };
    }

    connectedCallback() {
        super.connectedCallback();
        const wg = window.wg;
        this._subs.push(wg.on('wg:state', (s) => (this._state = s)));
        this._subs.push(wg.on('wg:status', (status) => (this._state = { ...(this._state || {}), status })));
        this._subs.push(
            wg.on('wg:rec-started', () => {
                this._recording = true;
                this._busy = false;
            })
        );
        this._subs.push(
            wg.on('wg:rec-stopped', () => {
                this._recording = false;
            })
        );
        this._subs.push(
            wg.on('wg:rec-cancelled', () => {
                this._recording = false;
                this._busy = false;
            })
        );
        this._subs.push(
            wg.on('wg:transcribe:result', ({ entry, copied }) => {
                this._busy = false;
                this._lastResultId = entry.id;
                if (copied) toast('Copied to clipboard', 'success');
            })
        );
        this._subs.push(
            wg.on('wg:transcribe:error', ({ message, kind }) => {
                this._busy = false;
                if (kind === 'info') toast(message, 'info', 3600);
                else toast(message, 'error', 5000);
            })
        );
        this._subs.push(
            wg.on('wg:backend-progress', (p) => {
                if (p.line) this._backendLog = [...this._backendLog.slice(-13), p.line];
            })
        );
        this._subs.push(
            wg.on('wg:open-settings', () => {
                this._view = 'settings';
            })
        );
        this._subs.push(
            wg.on('wg:models:progress', (p) => {
                this._modelsProgress = { ...this._modelsProgress, [p.key]: p };
                if (p.done && p.error) toast(`${p.name || p.key} failed: ${p.error}`, 'error', 6000);
                else if (p.done) toast(`${p.name || p.key} is ready`, 'success');
            })
        );
        window.addEventListener('keydown', this._escapeHandler);
        wg.invoke('wg:state:get').then((s) => {
            this._state = s;
        });
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        for (const unsub of this._subs) unsub();
        this._subs = [];
        window.removeEventListener('keydown', this._escapeHandler);
    }

    updated(changed) {
        if (!changed.has('_state')) return;
        const settings = this._state?.settings;
        if (!settings) return;
        const root = document.documentElement;
        root.style.setProperty('--header-background', `rgba(0, 0, 0, ${settings.appearance.transparency})`);
        root.style.setProperty('--main-content-background', `rgba(0, 0, 0, ${settings.appearance.transparency})`);
        root.style.setProperty('--response-font-size', `${settings.appearance.fontSize}px`);
        root.style.setProperty('--accent', settings.appearance.accent);
        root.style.setProperty('--accent-dim', hexToRgba(settings.appearance.accent, 0.25));
        root.classList.toggle('compact-layout', !!settings.appearance.compact);
    }

    _patchSettings(patch) {
        window.wg.invoke('wg:settings:set', patch);
    }

    async _sessionNew() {
        await window.wg.invoke('wg:session:new');
        this._view = 'main';
    }

    async _sessionOpen({ id }) {
        await window.wg.invoke('wg:session:open', { id });
        this._view = 'main';
    }

    async _sessionDelete({ id }) {
        await window.wg.invoke('wg:session:delete', { id });
    }

    async _sessionRename({ id, title }) {
        await window.wg.invoke('wg:session:rename', { id, title });
    }

    async _entrySave(detail) {
        await window.wg.invoke('wg:session:entry:update', detail);
    }

    async _entryDelete(detail) {
        await window.wg.invoke('wg:session:entry:delete', { sessionId: detail.sessionId || this._state?.activeSessionId, entryId: detail.id });
    }

    async _entryCopy({ text }) {
        await window.wg.invoke('wg:clipboard:copy', { text });
        toast('Copied to clipboard', 'success');
    }

    static styles = css`
        :host {
            display: block;
            height: 100vh;
        }
        .window {
            height: 100%;
            display: grid;
            grid-template-rows: 40px 1fr;
            border-radius: var(--radius-window);
            border: 1px solid var(--border-color);
            overflow: hidden;
            background: transparent;
        }
        .body {
            min-height: 0;
            background: var(--main-content-background);
            backdrop-filter: blur(28px);
            display: flex;
            min-width: 0;
        }
        .main {
            flex: 1;
            display: flex;
            min-width: 0;
            min-height: 0;
        }
        .view {
            flex: 1;
            display: flex;
            min-width: 0;
            min-height: 0;
            animation: viewin 0.15s ease-out;
        }
        @keyframes viewin {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
    `;

    render() {
        const s = this._state;
        if (!s) {
            return html`<div class="window"><div></div></div><wg-toast-stack></wg-toast-stack>`;
        }
        const settings = s.settings;
        const showSidebar = this._view === 'main' && settings.appearance.sidebarVisible;
        let content;
        if (!s.onboarded) {
            content = html`<onboarding-view
                class="view"
                .settings=${settings}
                .status=${s.status}
                .catalog=${s.catalog}
                .modelsProgress=${this._modelsProgress}
                .backendLog=${this._backendLog}
                @settings-patch=${(e) => this._patchSettings(e.detail)}
            ></onboarding-view>`;
        } else if (this._view === 'settings') {
            content = html`
                <settings-view
                    class="view"
                    .settings=${settings}
                    .status=${s.status}
                    .catalog=${s.catalog}
                    .keybindInfo=${s.keybindInfo}
                    .modelsProgress=${this._modelsProgress}
                    .backendLog=${this._backendLog}
                    @settings-patch=${(e) => this._patchSettings(e.detail)}
                ></settings-view>
            `;
        } else {
            content = html`
                <div class="main view">
                    ${showSidebar
                        ? html`<session-sidebar
                              .sessions=${s.sessions}
                              .activeId=${s.activeSessionId}
                              @session-new=${() => this._sessionNew()}
                              @session-open=${(e) => this._sessionOpen(e.detail)}
                              @session-delete=${(e) => this._sessionDelete(e.detail)}
                              @session-rename=${(e) => this._sessionRename(e.detail)}
                          ></session-sidebar>`
                        : ''}
                    <session-view
                        .session=${s.activeSession}
                        .settings=${settings}
                        .status=${s.status}
                        .recording=${this._recording}
                        .lastResultId=${this._lastResultId}
                        @entry-save=${(e) => this._entrySave(e.detail)}
                        @entry-copy=${(e) => this._entryCopy(e.detail)}
                        @entry-delete=${(e) => this._entryDelete(e.detail)}
                    ></session-view>
                </div>
            `;
        }
        return html`
            <div class="window">
                <app-header
                    .status=${s.status}
                    .settings=${settings}
                    .view=${this._view}
                    .recording=${this._recording}
                    @toggle-settings=${() => {
                        this._view = this._view === 'settings' ? 'main' : 'settings';
                    }}
                ></app-header>
                <div class="body">${content}</div>
            </div>
            <wg-toast-stack></wg-toast-stack>
        `;
    }
}

customElements.define('whisper-glass-app', WhisperGlassApp);
