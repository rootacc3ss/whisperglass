import { html, css, LitElement } from '../../assets/lit-core.min.js';
import '../common/wg-icon.js';

const MAX_ANIMATED_WORDS = 400;

class TranscriptionEntry extends LitElement {
    static properties = {
        entry: { type: Object },
        animate: { type: Boolean },
        compact: { type: Boolean },
        _editing: { state: true },
    };

    constructor() {
        super();
        this.entry = null;
        this.animate = false;
        this.compact = false;
        this._editing = false;
        this._originalText = '';
        this._revealTimer = null;
        this._revealed = false;
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._stopReveal();
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

    static styles = css`
        :host {
            display: block;
            margin: 2px 0;
        }
        .card {
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
        .spacer {
            flex: 1;
        }
        .actions {
            display: flex;
            gap: 2px;
            opacity: 0;
            transition: opacity 0.15s ease;
        }
        .card:hover .actions {
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
        :host(.compact) .card {
            padding: 6px 10px;
        }
        :host(.compact) .text {
            line-height: 1.45;
        }
    `;

    _renderWords() {
        const { entry } = this;
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

    render() {
        if (!this.entry) return html``;
        const e = this.entry;
        const time = new Date(e.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return html`
            <div class="card ${this._editing ? 'editing' : ''} ${this.animate && !this._revealed ? 'animating' : ''}">
                <div class="head">
                    <span class="time">${time}</span>
                    ${e.durationSec ? html`<span class="badge">${e.durationSec}s</span>` : ''}
                    <span class="badge">${e.engine} · ${e.model} · ${e.device}</span>
                    ${(e.speakers || []).map((s) => html`<span class="speaker">${s}</span>`)}
                    <span class="spacer"></span>
                    <div class="actions">
                        <button class="icon-btn" title="Copy text" @click=${() => this._copy()}>
                            <wg-icon name="copy" size="13"></wg-icon>
                        </button>
                        <button class="icon-btn danger" title="Delete entry" @click=${() => this._delete()}>
                            <wg-icon name="trash-2" size="13"></wg-icon>
                        </button>
                    </div>
                </div>
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
            </div>
        `;
    }
}

customElements.define('transcription-entry', TranscriptionEntry);
