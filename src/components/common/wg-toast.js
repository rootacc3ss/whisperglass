import { html, css, LitElement } from '../../assets/lit-core.min.js';
import './wg-icon.js';

export function toast(message, kind = 'info', timeout = 2600) {
    window.dispatchEvent(new CustomEvent('wg-toast', { detail: { message, kind, timeout } }));
}

class WgToastStack extends LitElement {
    static properties = {
        _items: { state: true },
    };

    constructor() {
        super();
        this._items = [];
        this._nextId = 1;
        this._onToast = (e) => this._push(e.detail || {});
    }

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener('wg-toast', this._onToast);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('wg-toast', this._onToast);
        this._items = [];
    }

    _push({ message, kind = 'info', timeout = 2600 }) {
        const id = this._nextId++;
        const item = { id, message: String(message || ''), kind };
        this._items = [...this._items.slice(-3), item];
        setTimeout(() => this._remove(id), timeout);
    }

    _remove(id) {
        const item = this._items.find((i) => i.id === id);
        if (!item) return;
        item.leaving = true;
        this._items = [...this._items];
        setTimeout(() => {
            this._items = this._items.filter((i) => i.id !== id);
        }, 220);
    }

    static styles = css`
        :host {
            position: fixed;
            bottom: 18px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 9999;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            pointer-events: none;
            width: max-content;
            max-width: 80vw;
        }
        .toast {
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(20, 20, 22, 0.94);
            border: 1px solid rgba(255, 255, 255, 0.12);
            backdrop-filter: blur(12px);
            border-radius: 8px;
            padding: 8px 14px;
            color: var(--text-color);
            font-size: 13px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
            animation: enter 0.2s ease-out;
            max-width: 100%;
        }
        .toast.leaving {
            opacity: 0;
            transition: opacity 0.2s ease-in;
        }
        .toast .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            flex: none;
        }
        .info .dot {
            background: var(--accent);
        }
        .success .dot {
            background: var(--success);
        }
        .error .dot {
            background: var(--danger);
        }
        wg-icon {
            flex: none;
        }
        @keyframes enter {
            from {
                opacity: 0;
                transform: translateY(8px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
    `;

    render() {
        return html`
            ${this._items.map(
                (item) => html`
                    <div class="toast ${item.kind} ${item.leaving ? 'leaving' : ''}">
                        <span class="dot"></span><span>${item.message}</span>
                    </div>
                `
            )}
        `;
    }
}

customElements.define('wg-toast-stack', WgToastStack);
