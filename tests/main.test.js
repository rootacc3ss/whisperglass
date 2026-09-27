import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore, SessionStore, defaultSettings, deepMerge, titleFromText } from '../src/main/store.js';
import { pcm16ToWavBuffer } from '../src/main/wav.js';
import { normalizeAccelerator } from '../src/main/keybinds.js';

let tmp;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-test-'));
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe('SettingsStore', () => {
    it('returns defaults when no file exists', () => {
        const store = new SettingsStore(tmp);
        const s = store.get();
        expect(s.engine).toBe('whisper');
        expect(s.autoCopy).toBe(true);
        expect(s.keybinds.toggleRecording).toBe('Ctrl+Shift+Space');
        expect(s.appearance.transparency).toBe(0.82);
    });

    it('persists patches to disk and reloads them', () => {
        const store = new SettingsStore(tmp);
        store.patch({ engine: 'whisperx', appearance: { fontSize: 24 } });
        const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'settings.json'), 'utf8'));
        expect(raw.engine).toBe('whisperx');
        expect(raw.appearance.fontSize).toBe(24);
        const store2 = new SettingsStore(tmp);
        expect(store2.get().engine).toBe('whisperx');
        expect(store2.get().appearance.fontSize).toBe(24);
    });

    it('deep merges without losing sibling keys', () => {
        const store = new SettingsStore(tmp);
        store.patch({ appearance: { compact: true } });
        const s = store.get();
        expect(s.appearance.compact).toBe(true);
        expect(s.appearance.fontSize).toBe(defaultSettings().appearance.fontSize);
    });

    it('keeps defaults if file is corrupt', () => {
        fs.writeFileSync(path.join(tmp, 'settings.json'), '{not json');
        const store = new SettingsStore(tmp);
        expect(store.get().engine).toBe('whisper');
    });
});

describe('deepMerge', () => {
    it('replaces arrays instead of merging', () => {
        const out = deepMerge({ a: [1, 2, 3] }, { a: [9] });
        expect(out.a).toEqual([9]);
    });
});

describe('SessionStore', () => {
    it('creates, lists, and opens sessions', () => {
        const store = new SessionStore(tmp);
        const a = store.create(1000);
        const b = store.create(2000);
        const list = store.list();
        expect(list.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
        expect(list.find((m) => m.id === b.id).entryCount).toBe(0);
        expect(store.get(a.id).title).toBe('New session');
    });

    it('auto-titles from first entry text', () => {
        const store = new SessionStore(tmp);
        const s = store.create();
        store.appendEntry(s.id, { id: 'e1', text: 'Hello world this is a test of titles', createdAt: 1 });
        expect(store.get(s.id).title).toBe('Hello world this is a test of');
        store.rename(s.id, '  Custom  ');
        expect(store.get(s.id).title).toBe('Custom');
    });

    it('updates and deletes entries', () => {
        const store = new SessionStore(tmp);
        const s = store.create();
        store.appendEntry(s.id, { id: 'e1', text: 'one', createdAt: 1 });
        store.appendEntry(s.id, { id: 'e2', text: 'two', createdAt: 2 });
        store.updateEntry(s.id, 'e1', 'ONE edited');
        const session = store.get(s.id);
        expect(session.entries[0].text).toBe('ONE edited');
        expect(session.entries).toHaveLength(2);
        store.deleteEntry(s.id, 'e1');
        expect(store.get(s.id).entries).toHaveLength(1);
        expect(store.get(s.id).entries[0].text).toBe('two');
    });

    it('deletes sessions', () => {
        const store = new SessionStore(tmp);
        const s = store.create();
        expect(store.delete(s.id)).toBe(true);
        expect(store.list()).toHaveLength(0);
        expect(store.get(s.id)).toBeNull();
    });

    it('survives corrupt session files', () => {
        fs.writeFileSync(path.join(tmp, 'garbage.json'), 'not json');
        const store = new SessionStore(tmp);
        expect(store.list()).toEqual([]);
    });
});

describe('titleFromText', () => {
    it('uses up to 7 words, max 48 chars', () => {
        expect(titleFromText('a b c', 0)).toBe('a b c');
        const long = 'word '.repeat(20).trim();
        expect(titleFromText(long, 0).length).toBeLessThanOrEqual(48);
    });
    it('falls back when text is empty', () => {
        expect(titleFromText('', 0)).toMatch(/Session/);
    });
});

describe('pcm16ToWavBuffer', () => {
    it('writes a valid 16kHz mono PCM16 WAV header', () => {
        const chunk = Buffer.from([0x01, 0x02, 0x03, 0x04]);
        const wav = pcm16ToWavBuffer([chunk, chunk]);
        expect(wav.length).toBe(44 + 8);
        expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
        expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
        expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
        expect(wav.readUInt32LE(16)).toBe(16);
        expect(wav.readUInt16LE(20)).toBe(1);
        expect(wav.readUInt16LE(22)).toBe(1);
        expect(wav.readUInt32LE(24)).toBe(16000);
        expect(wav.readUInt32LE(28)).toBe(32000);
        expect(wav.readUInt16LE(32)).toBe(2);
        expect(wav.readUInt16LE(34)).toBe(16);
        expect(wav.toString('ascii', 36, 40)).toBe('data');
        expect(wav.readUInt32LE(40)).toBe(8);
        expect(wav.subarray(44)).toEqual(Buffer.concat([chunk, chunk]));
    });
});

describe('normalizeAccelerator', () => {
    it('converts Arrow keys to Electron form', () => {
        expect(normalizeAccelerator('Ctrl+Alt+ArrowUp')).toBe('Ctrl+Alt+Up');
        expect(normalizeAccelerator('Ctrl+Shift+Space')).toBe('Ctrl+Shift+Space');
        expect(normalizeAccelerator('')).toBe('');
    });
});
