import { html, css, LitElement } from '../../assets/lit-core.min.js';
import '../common/wg-icon.js';

const MAX_ANIMATED_WORDS = 400;

class TranscriptionEntry extends LitElement {
    static properties = {
        entry: { type: Object },
        animate: { type: Boolean },
        compact: { type: Boolean },
        aiEnabled: { type: Boolean },
        aiBusy: { type: Boolean },
        audioSrc: { type: String },
        _editing: { state: true },
    };

    constructor() {
        super();
        this.entry = null;
        this.animate = false;
        this.compact = false;
        this.aiEnabled = false;
        this.aiBusy = false;
        this.audioSrc = '';
        this._editing = false;
        this._originalText = '';
        this._revealTimer = null;
        this._revealed = false;
        this._menuOpen = false;
        this._customOpen = false;
        this._customPrompt = '';
        this._playerOpen = false;
        this._playing = false;
        this._audioEl = null;
        this._activeWord = -1;
        this._outsideClick = null;
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._stopReveal();
        this._closeMenu();
        this._detachAudio();
    }

    updated(changed) {
        if (changed.has('animate')) this._scheduleReveal();
    }

    firstUpdated() {
        this._scheduleReveal();
    }

    _scheduleReveal() {
        this._stopReveal();
        if (!this.animate || !this.entry || this._revealed) return;
        const words = this.renderRoot.querySelectorAll('[data-word]');
        const count = words.length;
        if (!count || count > MAX_ANIMATED_WORDS) {
            this._revealed = true;
            return;
        }
        const stagger = Math.max(12, Math.min(100, Math.round(2000 / count)));
        let index = 0;
        this._revealTimer = setInterval(() => {
            if (index >= count) {
                this._stopReveal();
                return;
            }
            words[index].classList.add('visible');
            index += 1;
        }, stagger);
    }

    _stopReveal() {
        if (this._revealTimer) {
            clearInterval(this._revealTimer);
            this._revealTimer = null;
        }
    }

    _enterEdit() {
        if (this._editing || !this.entry) return;
        this._editing = true;
        this._originalText = this.entry.text;
        this.updateComplete.then(() => {
            const el = this.renderRoot.querySelector('.text.editable');
            if (el) {
                el.focus();
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(el);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        });
    }

    _exitEdit(save) {
        if (!this._editing) return;
        const el = this.renderRoot.querySelector('.text.editable');
        const newText = el ? el.innerText.replace(/\n$/, '') : '';
        this._editing = false;
        if (save && newText !== this._originalText) {
            this.dispatchEvent(
                new CustomEvent('entry-save', {
                    detail: { id: this.entry.id, text: newText },
                    bubbles: true,
                    composed: true,
                })
            );
        }
    }

    _copy() {
        this.dispatchEvent(
            new CustomEvent('entry-copy', { detail: { text: this.entry.text }, bubbles: true, composed: true })
        );
    }

    _delete() {
        this.dispatchEvent(
            new CustomEvent('entry-delete', { detail: { id: this.entry.id }, bubbles: true, composed: true })
        );
    }

    _runAi(action, prompt) {
        this._closeMenu();
        this.dispatchEvent(
            new CustomEvent('entry-ai', {
                detail: { id: this.entry.id, action, prompt: prompt || '' },
                bubbles: true,
                composed: true,
            })
        );
    }

    _revealSource(sourceId) {
        this.dispatchEvent(
            new CustomEvent('entry-reveal', { detail: { id: sourceId }, bubbles: true, composed: true })
        );
    }

    _toggleMenu() {
        if (this._menuOpen) {
            this._closeMenu();
            return;
        }
        this._menuOpen = true;
        this._customOpen = false;
        this._outsideClick = (e) => {
            if (!this.renderRoot.contains(e.composedPath ? e.composedPath()[0] : e.target)) this._closeMenu();
        };
        window.addEventListener('click', this._outsideClick, true);
    }

    _closeMenu() {
        this._menuOpen = false;
        this._customOpen = false;
        if (this._outsideClick) {
            window.removeEventListener('click', this._outsideClick, true);
            this._outsideClick = null;
        }
    }

    _runCustom() {
        const prompt = (this._customPrompt || '').trim();
        if (!prompt) return;
        this._customPrompt = '';
        this._runAi('custom', prompt);
    }

    // ---- audio player ----

    _togglePlayer() {
        this._playerOpen = !this._playerOpen;
        if (this._playerOpen) {
            this.updateComplete.then(() => this._attachAudio());
        } else {
            this._detachAudio();
        }
    }

    _attachAudio() {
        if (!this.audioSrc) return;
        let el = this.renderRoot.querySelector('audio');
        if (!el) return;
        this._audioEl = el;
        el.addEventListener('timeupdate', () => {
            const t = el.currentTime;
            const words = this.entry?.words || [];
            let idx = -1;
            for (let i = 0; i < words.length; i++) {
                const w = words[i];
                if (w.start == null) continue;
                if (t >= w.start && t <= (w.end ?? w.start)) {
                    idx = i;
                    break;
                }
                if (w.start > t) break;
                idx = i;
            }
            if (idx !== this._activeWord) {
                this._activeWord = idx;
                this.requestUpdate();
            }
        });
        el.addEventListener('play', () => {
            this._playing = true;
            this.requestUpdate();
        });
        el.addEventListener('pause', () => {
            this._playing = false;
            this.requestUpdate();
        });
    }

    _detachAudio() {
        if (this._audioEl) {
            try {
                this._audioEl.pause();
            } catch {}
            this._audioEl = null;
        }
        this._playing = false;
        this._activeWord = -1;
    }

    _playPause() {
        const el = this.renderRoot.querySelector('audio');
        if (!el) return;
        if (el.paused) el.play().catch(() => {});
        else el.pause();
    }

    _seek(e) {
        const el = this.renderRoot.querySelector('audio');
        if (!el || !el.duration) return;
        el.currentTime = (parseFloat(e.target.value) / 100) * el.duration;
        this.requestUpdate();
    }

    _seekWord(w) {
        const el = this.renderRoot.querySelector('audio');
        if (!el || w.start == null) return;
        el.currentTime = w.start;
        if (el.paused) el.play().catch(() => {});
    }

    static styles = css`
        :host {
            display: block;
            margin: 2px 0;
        }
        .card {
            position: relative;
            background: var(--card-background);
            border: 1px solid var(--button-border);
            border-radius: 10px;
            backdrop-filter: blur(10px);
            padding: 10px 14px;
            transition: border-color 0.15s ease;
        }
        .card:hover {
            border-color: rgba(255, 255, 255, 0.18);
        }
        .card.ai {
            border-color: rgba(167, 139, 250, 0.35);
        }
        .card.ai:hover {
            border-color: rgba(167, 139, 250, 0.6);
        }
        .head {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 11px;
            color: var(--text-dim);
            margin-bottom: 4px;
            flex-wrap: wrap;
        }
        .time {
            font-variant-numeric: tabular-nums;
        }
        .badge {
            font-family: var(--mono);
            background: rgba(255, 255, 255, 0.06);
            border-radius: 4px;
            padding: 1px 6px;
        }
        .speaker {
            font-family: var(--mono);
            background: var(--accent-dim);
            color: var(--text-color);
            border-radius: 4px;
            padding: 1px 6px;
        }
        .ai-tag {
            font-size: 9.5px;
            font-weight: 700;
            letter-spacing: 0.8px;
            background: rgba(167, 139, 250, 0.18);
            color: #c4b5fd;
            border-radius: 4px;
            padding: 1.5px 6px;
        }
        .src-link {
            font-size: 10px;
            color: var(--text-dim);
            background: none;
            border: none;
            cursor: pointer;
            padding: 1px 4px;
            border-radius: 4px;
        }
        .src-link:hover {
            background: var(--hover-background);
            color: var(--text-color);
        }
        .spacer {
            flex: 1;
        }
        .actions {
            display: flex;
            gap: 2px;
            opacity: 0;
            transition: opacity 0.15s ease;
        }
        .card:hover .actions,
        .actions.open {
            opacity: 1;
        }
        .icon-btn {
            background: none;
            border: none;
            color: var(--text-dim);
            width: 22px;
            height: 22px;
            border-radius: 5px;
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
        .icon-btn.danger:hover {
            color: var(--danger);
            background: rgba(239, 68, 68, 0.12);
        }
        .icon-btn.ai {
            color: #a78bfa;
        }
        .icon-btn.ai:hover {
            background: rgba(167, 139, 250, 0.14);
            color: #c4b5fd;
        }
        .menu {
            position: absolute;
            top: 30px;
            right: 10px;
            z-index: 10;
            background: rgba(24, 24, 28, 0.97);
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 8px;
            box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
            padding: 4px;
            min-width: 200px;
        }
        .menu button {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            text-align: left;
            background: none;
            border: none;
            color: var(--text-color);
            font-size: 12.5px;
            padding: 7px 10px;
            border-radius: 6px;
            cursor: pointer;
        }
        .menu button:hover {
            background: var(--hover-background);
        }
        .menu .sub {
            display: block;
            font-size: 10.5px;
            color: var(--text-dim);
        }
        .menu textarea {
            width: 100%;
            min-height: 54px;
            margin: 6px 0 4px;
            box-sizing: border-box;
        }
        .menu .run {
            background: var(--accent);
            color: #fff;
            justify-content: center;
        }
        .text {
            font-size: var(--response-font-size);
            line-height: 1.55;
            color: var(--text-color);
            white-space: pre-wrap;
            word-break: break-word;
            user-select: text;
            cursor: text;
            outline: none;
        }
        .text.editable {
            border: 1px solid var(--accent);
            background: rgba(0, 122, 255, 0.04);
            border-radius: 6px;
            padding: 4px 8px;
            margin: 0 -8px;
            cursor: text;
        }
        [data-word] {
            display: inline;
            cursor: pointer;
        }
        .animating [data-word] {
            display: inline-block;
            opacity: 0;
            filter: blur(10px);
            transition: opacity 0.5s, filter 0.5s;
        }
        .animating [data-word].visible {
            opacity: 1;
            filter: blur(0);
        }
        [data-word].active {
            background: var(--accent-dim);
            border-radius: 3px;
        }
        [data-word].active.ai {
            background: rgba(167, 139, 250, 0.25);
        }
        .player {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid rgba(255, 255, 255, 0.07);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .player .pbtn {
            width: 30px;
            height: 30px;
            border-radius: 50%;
            border: none;
            background: var(--accent);
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            flex: none;
        }
        .player input[type='range'] {
            flex: 1;
            -webkit-appearance: none;
            appearance: none;
            height: 4px;
            border-radius: 2px;
            background: rgba(255, 255, 255, 0.16);
            outline: none;
            cursor: pointer;
        }
        .player input[type='range']::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: var(--accent);
            cursor: pointer;
            border: none;
        }
        .player .ptime {
            font-family: var(--mono);
            font-size: 10.5px;
            color: var(--text-dim);
            font-variant-numeric: tabular-nums;
            flex: none;
        }
        .spin {
            animation: e-spin 1s linear infinite;
        }
        @keyframes e-spin {
            to {
                transform: rotate(360deg);
            }
        }
        :host(.compact) .card {
            padding: 6px 10px;
        }
        :host(.compact) .text {
            line-height: 1.45;
        }
        :host(.flash) .card {
            border-color: var(--accent);
            box-shadow: 0 0 0 3px var(--accent-dim);
        }
    `;

    _renderWords() {
        const { entry } = this;
        const karaoke = this._playerOpen && entry.words && entry.words.length;
        if (karaoke) {
            return entry.words.map(
                (w, i) =>
                    html`<span
                        data-word
                        class=${i === this._activeWord ? 'active' : ''}
                        title=${w.start != null ? `${w.word} · ${w.start.toFixed(2)}–${w.end != null ? w.end.toFixed(2) : '?'}s` : w.word}
                        @click=${() => this._seekWord(w)}
                        >${w.word}</span> `
            );
        }
        if (entry.words && entry.words.length) {
            return entry.words.map(
                (w) =>
                    html`<span
                        data-word
                        title=${w.start != null ? `${w.word} · ${w.start.toFixed(2)}–${w.end != null ? w.end.toFixed(2) : '?'}s` : w.word}
                        >${w.word}</span> `
            );
        }
        return String(entry.text || '')
            .split(/\s+/)
            .filter(Boolean)
            .map((word) => html`<span data-word>${word}</span> `);
    }

    _renderAiMenu() {
        if (!this._menuOpen) return html``;
        return html`
            <div class="menu">
                ${this._customOpen
                    ? html`
                          <div style="padding:6px 10px 0;font-size:11px;color:var(--text-dim)">Custom prompt</div>
                          <textarea
                              placeholder="e.g. rewrite as a bullet list…"
                              .value=${this._customPrompt}
                              @input=${(e) => (this._customPrompt = e.target.value)}
                          ></textarea>
                          <button class="run" @click=${() => this._runCustom()}>
                              <wg-icon name="sparkles" size="12"></wg-icon> Run
                          </button>
                      `
                    : html`
                          <button @click=${() => this._runAi('improve')}>
                              <wg-icon name="sparkles" size="13"></wg-icon>
                              <span>Improve clarity &amp; readability<span class="sub">Removes uh/um, stutters — same language</span></span>
                          </button>
                          <button @click=${() => this._runAi('summarize')}>
                              <wg-icon name="panel-left" size="13"></wg-icon>
                              <span>Summarize<span class="sub">Keeps core details</span></span>
                          </button>
                          <button @click=${() => {
                              this._customOpen = true;
                          }}>
                              <wg-icon name="edit-3" size="13"></wg-icon>
                              <span>Custom prompt…</span>
                          </button>
                      `}
            </div>
        `;
    }

    _renderPlayer() {
        if (!this._playerOpen || !this.audioSrc) return html``;
        const el = this.renderRoot.querySelector('audio');
        const dur = el && el.duration && isFinite(el.duration) ? el.duration : (this.entry?.durationSec || 0);
        const cur = el ? el.currentTime : 0;
        const pct = dur ? Math.round((cur / dur) * 100) : 0;
        const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
        return html`
            <div class="player">
                <audio src=${this.audioSrc} @ended=${() => (this._playing = false)}></audio>
                <button class="pbtn" @click=${() => this._playPause()}>
                    <wg-icon name=${this._playing ? 'pause' : 'play'} size="12"></wg-icon>
                </button>
                <input type="range" min="0" max="100" step="0.5" .value=${String(pct)} @input=${(e) => this._seek(e)} />
                <span class="ptime">${fmt(cur)} / ${fmt(dur)}</span>
            </div>
        `;
    }

    render() {
        if (!this.entry) return html``;
        const e = this.entry;
        const isAi = e.kind === 'ai';
        const time = new Date(e.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return html`
            <div class="card ${isAi ? 'ai' : ''} ${this._editing ? 'editing' : ''} ${this.animate && !this._revealed ? 'animating' : ''}">
                <div class="head">
                    <span class="time">${time}</span>
                    ${isAi
                        ? html`<span class="ai-tag">AI OUTPUT · ${e.aiAction || 'custom'}</span>
                              ${e.model ? html`<span class="badge">${e.model}</span>` : ''}
                              ${e.sourceEntryId
                                  ? html`<button class="src-link" title="Jump to source transcript" @click=${() => this._revealSource(e.sourceEntryId)}>
                                        ↖ source
                                    </button>`
                                  : ''}`
                        : html`${e.durationSec ? html`<span class="badge">${e.durationSec}s</span>` : ''}
                              <span class="badge">${e.engine} · ${e.model} · ${e.device}</span>
                              ${(e.speakers || []).map((s) => html`<span class="speaker">${s}</span>`)}`}
                    <span class="spacer"></span>
                    <div class="actions ${this._menuOpen || this.aiBusy ? 'open' : ''}">
                        ${this.aiBusy
                            ? html`<wg-icon class="spin" name="spinner" size="14" style="color:#a78bfa"></wg-icon>`
                            : !isAi && this.aiEnabled
                              ? html`<button class="icon-btn ai" title="AI actions" @click=${() => this._toggleMenu()}>
                                      <wg-icon name="sparkles" size="13"></wg-icon>
                                  </button>`
                              : ''}
                        ${this.audioSrc
                            ? html`<button class="icon-btn" title="Listen to recording" @click=${() => this._togglePlayer()}>
                                  <wg-icon name=${this._playerOpen ? 'x' : 'play'} size="13"></wg-icon>
                              </button>`
                            : ''}
                        <button class="icon-btn" title="Copy text" @click=${() => this._copy()}>
                            <wg-icon name="copy" size="13"></wg-icon>
                        </button>
                        <button class="icon-btn danger" title="Delete entry" @click=${() => this._delete()}>
                            <wg-icon name="trash-2" size="13"></wg-icon>
                        </button>
                    </div>
                </div>
                ${this._renderAiMenu()}
                ${this._editing
                    ? html`<div
                          class="text editable"
                          contenteditable="true"
                          spellcheck="false"
                          @keydown=${(ev) => {
                              ev.stopPropagation();
                              if (ev.key === 'Enter' && !ev.shiftKey) {
                                  ev.preventDefault();
                                  this._exitEdit(true);
                              } else if (ev.key === 'Escape') {
                                  ev.preventDefault();
                                  this._exitEdit(false);
                              }
                          }}
                          @blur=${() => this._exitEdit(true)}
                          @click=${(ev) => ev.stopPropagation()}
                          .innerText=${e.text}
                      ></div>`
                    : html`<div class="text" @click=${() => this._enterEdit()}>${this._renderWords()}</div>`}
                ${this._renderPlayer()}
            </div>
        `;
    }
}

customElements.define('transcription-entry', TranscriptionEntry);
