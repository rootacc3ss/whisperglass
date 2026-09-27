import { html, css, LitElement } from '../../assets/lit-core.min.js';
import './wg-icon.js';

function relativeTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 7 * 86400000) return new Date(ts).toLocaleDateString([], { weekday: 'short' });
    return new Date(ts).toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

class SessionSidebar extends LitElement {
    static properties = {
        sessions: { type: Array },
        activeId: { type: String },
        _renaming: { state: true },
        _confirmingDelete: { state: true },
    };

    constructor() {
        super();
        this.sessions = [];
        this.activeId = '';
        this._renaming = null;
        this._confirmingDelete = null;
        this._releaseTimer = null;
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._releaseTimer) clearTimeout(this._releaseTimer);
    }

    _open(id) {
        if (this._renaming) return;
        this.dispatchEvent(new CustomEvent('session-open', { detail: { id }, bubbles: true, composed: true }));
    }

    _startRename(session) {
        this._renaming = session.id;
        this._confirmingDelete = null;
        this.updateComplete.then(() => {
            const input = this.renderRoot.querySelector('input.rename');
            if (input) {
                input.focus();
                input.select();
            }
        });
    }

    _commitRename(id) {
        const input = this.renderRoot.querySelector('input.rename');
        const value = input ? input.value.trim().slice(0, 80) : '';
        this._renaming = null;
        if (value) {
            this.dispatchEvent(
                new CustomEvent('session-rename', { detail: { id, title: value }, bubbles: true, composed: true })
            );
        }
    }

    _cancelRename() {
        this._renaming = null;
    }

    _deleteClick(id) {
        if (this._confirmingDelete === id) {
            if (this._releaseTimer) clearTimeout(this._releaseTimer);
            this._confirmingDelete = null;
            this.dispatchEvent(new CustomEvent('session-delete', { detail: { id }, bubbles: true, composed: true }));
            return;
        }
        this._confirmingDelete = id;
        if (this._releaseTimer) clearTimeout(this._releaseTimer);
        this._releaseTimer = setTimeout(() => {
            this._confirmingDelete = null;
        }, 2500);
    }

    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            width: 190px;
            min-width: 190px;
            height: 100%;
            background: rgba(0, 0, 0, 0.35);
            border-right: 1px solid var(--border-color);
            padding: 10px;
            gap: 8px;
            font-size: 13px;
        }
        .head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 2px;
            user-select: none;
        }
        .label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-dim);
            font-weight: 600;
        }
        .new-btn {
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
        }
        .new-btn:hover {
            background: var(--hover-background);
            color: var(--text-color);
        }
        .list {
            flex: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 2px;
            margin: 0 -4px;
            padding: 0 4px;
        }
        .row {
            display: flex;
            align-items: center;
            gap: 6px;
            border-radius: 6px;
            padding: 6px 8px;
            border: 1px solid transparent;
            cursor: pointer;
            position: relative;
            min-width: 0;
        }
        .row:hover {
            background: rgba(255, 255, 255, 0.05);
        }
        .row.active {
            background: var(--hover-background);
            border-color: var(--button-border);
        }
        .row.active::before {
            content: '';
            position: absolute;
            left: 0;
            top: 6px;
            bottom: 6px;
            width: 2px;
            border-radius: 2px;
            background: var(--accent);
        }
        .meta {
            flex: 1;
            min-width: 0;
        }
        .title {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: var(--text-color);
        }
        .row.active .title {
            font-weight: 500;
        }
        .sub {
            font-size: 11px;
            color: var(--text-dim);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-top: 1px;
        }
        .del {
            background: none;
            border: none;
            color: var(--text-dim);
            width: 22px;
            height: 22px;
            border-radius: 5px;
            display: none;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            padding: 0;
            flex: none;
        }
        .row:hover .del {
            display: flex;
        }
        .del:hover {
            background: rgba(239, 68, 68, 0.15);
            color: var(--danger);
        }
        .del.confirm {
            display: flex;
            color: var(--danger);
            background: rgba(239, 68, 68, 0.15);
        }
        input.rename {
            width: 100%;
            background: var(--input-background);
            border: 1px solid var(--accent);
            border-radius: 4px;
            color: var(--text-color);
            font-size: 13px;
            padding: 3px 6px;
            outline: none;
        }
        .empty {
            color: var(--text-dim);
            font-size: 12px;
            padding: 12px 4px;
            text-align: center;
        }
    `;

    render() {
        return html`
            <div class="head">
                <span class="label">Sessions</span>
                <button
                    class="new-btn"
                    title="New session"
                    @click=${() =>
                        this.dispatchEvent(new CustomEvent('session-new', { bubbles: true, composed: true }))}
                >
                    <wg-icon name="plus" size="15"></wg-icon>
                </button>
            </div>
            <div class="list">
                ${this.sessions.length === 0
                    ? html`<div class="empty">No sessions yet</div>`
                    : this.sessions.map(
                          (s) => html`
                              <div
                                  class="row ${s.id === this.activeId ? 'active' : ''}"
                                  @click=${() => this._open(s.id)}
                                  @dblclick=${() => this._startRename(s)}
                              >
                                  ${this._renaming === s.id
                                      ? html`<div class="meta" @click=${(e) => e.stopPropagation()}>
                                            <input
                                                class="rename"
                                                .value=${s.title}
                                                @keydown=${(e) => {
                                                    e.stopPropagation();
                                                    if (e.key === 'Enter') this._commitRename(s.id);
                                                    else if (e.key === 'Escape') this._cancelRename();
                                                }}
                                                @blur=${() => this._commitRename(s.id)}
                                                @click=${(e) => e.stopPropagation()}
                                            />
                                        </div>`
                                      : html`<div class="meta">
                                            <div class="title">${s.title}</div>
                                            <div class="sub">
                                                ${relativeTime(s.updatedAt)}${s.entryCount
                                                    ? ` · ${s.entryCount}`
                                                    : ''}
                                            </div>
                                        </div>`}
                                  <button
                                      class="del ${this._confirmingDelete === s.id ? 'confirm' : ''}"
                                      title="${this._confirmingDelete === s.id ? 'Click again to delete' : 'Delete session'}"
                                      @click=${(e) => {
                                          e.stopPropagation();
                                          this._deleteClick(s.id);
                                      }}
                                  >
                                      <wg-icon name="trash-2" size="13"></wg-icon>
                                  </button>
                              </div>
                          `
                      )}
            </div>
        `;
    }
}

customElements.define('session-sidebar', SessionSidebar);
