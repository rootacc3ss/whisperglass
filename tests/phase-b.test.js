import { describe, it, expect } from 'vitest';
import { comboToGsettings, parseGvariantArray } from '../src/main/gnome-keybind.js';
import { DEFAULT_KEYBINDS, normalizeAccelerator } from '../src/main/keybinds.js';
import { defaultSettings, deepMerge } from '../src/main/store.js';

describe('comboToGsettings', () => {
    it('converts app combos to gsettings bindings', () => {
        expect(comboToGsettings('Alt+Shift+T')).toBe('<alt><shift>t');
        expect(comboToGsettings('Ctrl+\\')).toBe('<ctrl>\\');
        expect(comboToGsettings('Ctrl+Shift+Space')).toBe('<ctrl><shift>space');
        expect(comboToGsettings('Super+F2')).toBe('<super>f2');
    });
    it('lowercases plain keys', () => {
        expect(comboToGsettings('Alt+X')).toBe('<alt>x');
    });
});

describe('parseGvariantArray', () => {
    it('parses populated arrays', () => {
        expect(parseGvariantArray("['/a/', '/b/']")).toEqual(['/a/', '/b/']);
    });
    it('handles empty GVariant arrays', () => {
        expect(parseGvariantArray('@as []')).toEqual([]);
        expect(parseGvariantArray('')).toEqual([]);
    });
    it('survives garbage', () => {
        expect(parseGvariantArray('not valid at all')).toEqual([]);
    });
});

describe('keybind registration map semantics', () => {
    it('defaults include systemKeybind flag', () => {
        expect(DEFAULT_KEYBINDS.systemKeybind).toBe(false);
        expect(DEFAULT_KEYBINDS.toggleVisibility).toBe('Ctrl+\\');
    });
    it('deleting toggleVisibility from the map simulates system-keybind mode', () => {
        const map = { ...DEFAULT_KEYBINDS };
        delete map.toggleVisibility;
        expect('toggleVisibility' in map).toBe(false);
        expect(map.toggleRecording).toBe('Ctrl+Shift+Space');
    });
});

describe('new settings defaults', () => {
    it('has all phase B/C/D fields', () => {
        const s = defaultSettings();
        expect(s.micDeviceId).toBe('');
        expect(s.micLabel).toBe('');
        expect(s.liveTranscription).toEqual({ enabled: false, model: '' });
        expect(s.keybinds.systemKeybind).toBe(false);
        expect(s.appearance.showTray).toBe(true);
        expect(s.hints.hideToastShown).toBe(false);
        expect(s.debug.verboseLogging).toBe(false);
    });
    it('deep merges new defaults into old stored settings', () => {
        const old = { engine: 'whisperx', appearance: { transparency: 0.5 } };
        const merged = deepMerge(defaultSettings(), old);
        expect(merged.engine).toBe('whisperx');
        expect(merged.appearance.transparency).toBe(0.5);
        expect(merged.appearance.showTray).toBe(true);
        expect(merged.liveTranscription.enabled).toBe(false);
        expect(merged.hints.hideToastShown).toBe(false);
    });
});

describe('normalizeAccelerator', () => {
    it('still normalizes arrows', () => {
        expect(normalizeAccelerator('Ctrl+Alt+ArrowLeft')).toBe('Ctrl+Alt+Left');
    });
});
