import { describe, it, expect } from 'vitest';
import { comboToGsettings, normalizeBinding, isValidBinding } from '../src/main/gnome-keybind.js';

describe('comboToGsettings', () => {
    it('maps modifiers and plain keys', () => {
        expect(comboToGsettings('Ctrl+\\')).toBe('<ctrl>\\');
        expect(comboToGsettings('Alt+Shift+W')).toBe('<alt><shift>w');
        expect(comboToGsettings('Ctrl+Shift+Space')).toBe('<ctrl><shift>space');
        expect(comboToGsettings('Ctrl+Shift+0')).toBe('<ctrl><shift>0');
    });

    it('maps aliases', () => {
        expect(comboToGsettings('Control+A')).toBe('<ctrl>a');
        expect(comboToGsettings('Super+T')).toBe('<super>t');
        expect(comboToGsettings('Meta+T')).toBe('<super>t');
        expect(comboToGsettings('Alt+Enter')).toBe('<alt>return');
        expect(comboToGsettings('Alt+Esc')).toBe('<alt>escape');
        expect(comboToGsettings('Ctrl+PgUp')).toBe('<ctrl>pgup');
    });

    it('handles empty and garbage', () => {
        expect(comboToGsettings('')).toBe('');
        expect(comboToGsettings('+++')).toBe('');
    });
});

describe('normalizeBinding', () => {
    it('lowercases and unifies control', () => {
        expect(normalizeBinding("'<Control><Shift>T'")).toBe('<ctrl><shift>t');
        expect(normalizeBinding("'<Alt><Shift>t'")).toBe('<alt><shift>t');
        expect(normalizeBinding('@as []')).toBe('@as []');
    });
});

describe('isValidBinding', () => {
    it('accepts letters, digits, space, F-keys, nav keys', () => {
        expect(isValidBinding('<ctrl><shift>space')).toBe(true);
        expect(isValidBinding('<alt><shift>w')).toBe(true);
        expect(isValidBinding('<ctrl><shift>f5')).toBe(true);
        expect(isValidBinding('<super>pgdn')).toBe(true);
        expect(isValidBinding('9')).toBe(true);
        expect(isValidBinding('<alt>return')).toBe(true);
    });

    it('rejects junk and bare modifiers', () => {
        expect(isValidBinding('')).toBe(false);
        expect(isValidBinding('<ctrl><shift>')).toBe(false);
        expect(isValidBinding('<ctrl><shift>?')).toBe(false);
        expect(isValidBinding('<ctrl><shift>ctrl1')).toBe(false);
    });
});
