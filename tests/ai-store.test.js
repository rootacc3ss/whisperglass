import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore, SettingsStore } from '../src/main/store.js';
import { buildMessages, normalizeBaseUrl } from '../src/main/ai.js';

let dir;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wg-store-'));
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('SessionStore.insertEntryAfter', () => {
    it('inserts an AI entry directly below its source', () => {
        const store = new SessionStore(dir);
        const s = store.create();
        const a = { id: 'a', text: 'first transcript', createdAt: 1, kind: 'transcript' };
        const b = { id: 'b', text: 'second transcript', createdAt: 2, kind: 'transcript' };
        store.appendEntry(s.id, a);
        store.appendEntry(s.id, b);
        const aiEntry = { id: 'ai1', kind: 'ai', aiAction: 'improved', sourceEntryId: 'a', text: 'cleaned', createdAt: 3, model: 'gpt-x' };
        const updated = store.insertEntryAfter(s.id, 'a', aiEntry);
        expect(updated.entries.map((e) => e.id)).toEqual(['a', 'ai1', 'b']);
        expect(store.get(s.id).entries[1].sourceEntryId).toBe('a');
    });

    it('falls back to append when the anchor is missing', () => {
        const store = new SessionStore(dir);
        const s = store.create();
        store.appendEntry(s.id, { id: 'a', text: 'hello', createdAt: 1 });
        const aiEntry = { id: 'ai1', kind: 'ai', text: 'x', createdAt: 2 };
        const updated = store.insertEntryAfter(s.id, 'gone', aiEntry);
        expect(updated.entries.map((e) => e.id)).toEqual(['a', 'ai1']);
    });

    it('does not retitle the session for AI entries', () => {
        const store = new SessionStore(dir);
        const s = store.create();
        store.appendEntry(s.id, { id: 'a', text: 'the first words of the title', createdAt: 1 });
        expect(store.get(s.id).title).toBe('the first words of the title');
        store.insertEntryAfter(s.id, 'a', { id: 'ai1', kind: 'ai', text: 'never used for titles', createdAt: 2 });
        expect(store.get(s.id).title).toBe('the first words of the title');
    });
});

describe('SettingsStore aiAssist defaults', () => {
    it('deep-merges aiAssist settings', () => {
        const store = new SettingsStore(dir);
        expect(store.get().aiAssist).toEqual({
            enabled: false,
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            model: '',
            autoRefine: false,
        });
        store.patch({ aiAssist: { enabled: true, model: 'gpt-4o-mini' } });
        const a = store.get().aiAssist;
        expect(a.enabled).toBe(true);
        expect(a.model).toBe('gpt-4o-mini');
        expect(a.baseUrl).toBe('https://api.openai.com/v1');
    });
});

describe('buildMessages', () => {
    const entries = [
        { id: '1', text: 'hello there', createdAt: 1 },
        { id: '2', text: 'um so uh the quick brown fox', createdAt: 2 },
        { id: 'ai1', kind: 'ai', text: 'the quick brown fox', createdAt: 3 },
    ];

    it('improve: system prompt + transcript', () => {
        const msgs = buildMessages(entries, '2', 'improve');
        expect(msgs).toHaveLength(2);
        expect(msgs[0].role).toBe('system');
        expect(msgs[1].content).toContain('um so uh the quick brown fox');
    });

    it('includes prior session entries as context, AI entries labeled', () => {
        const msgs = buildMessages(entries, 'ai1', 'improve');
        expect(msgs[1].content).toContain('[transcript] hello there');
        expect(msgs[1].content).toContain('[transcript] um so uh the quick brown fox');
        expect(msgs[1].content).toContain('the quick brown fox');
    });

    it('custom: appends instruction', () => {
        const msgs = buildMessages(entries, '2', 'custom', 'make it a haiku');
        expect(msgs[1].content).toContain('Instruction: make it a haiku');
    });

    it('throws for unknown action / missing entry', () => {
        expect(() => buildMessages(entries, '2', 'explode')).toThrow();
        expect(() => buildMessages(entries, 'nope', 'improve')).toThrow();
    });

    it('caps context size', () => {
        const many = Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, text: 'x'.repeat(200), createdAt: i }));
        const msgs = buildMessages(many, 'e19', 'improve');
        expect(msgs[1].content.length).toBeLessThan(2400 + 600);
        expect(msgs[1].content).not.toContain('[transcript] x'.repeat(5));
    });
});

describe('normalizeBaseUrl', () => {
    it('appends /chat/completions', () => {
        expect(normalizeBaseUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/chat/completions');
        expect(normalizeBaseUrl('http://localhost:1234/v1/')).toBe('http://localhost:1234/v1/chat/completions');
    });
    it('leaves full paths alone', () => {
        expect(normalizeBaseUrl('https://x/y/chat/completions')).toBe('https://x/y/chat/completions');
    });
    it('throws on empty', () => {
        expect(() => normalizeBaseUrl('')).toThrow();
    });
});
