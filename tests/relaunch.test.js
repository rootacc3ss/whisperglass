import { describe, it, expect, afterEach } from 'vitest';
import { relaunchOptions, keybindExecPath } from '../src/main/relaunch.js';

describe('relaunchOptions', () => {
    afterEach(() => {
        delete process.env.APPIMAGE;
    });

    it('targets $APPIMAGE when running from an AppImage', () => {
        process.env.APPIMAGE = '/home/me/WhisperGlass-0.2.1.AppImage';
        expect(relaunchOptions(['--ozone-platform=x11'])).toEqual({
            args: ['--ozone-platform=x11'],
            execPath: '/home/me/WhisperGlass-0.2.1.AppImage',
        });
    });

    it('leaves execPath unset outside AppImages', () => {
        delete process.env.APPIMAGE;
        expect(relaunchOptions(['--flag'])).toEqual({ args: ['--flag'] });
        expect('execPath' in relaunchOptions([])).toBe(false);
    });

    it('passes args through verbatim (relay flags must round-trip)', () => {
        process.env.APPIMAGE = '/x/WhisperGlass.AppImage';
        expect(relaunchOptions(['--toggle', '--ozone-platform=x11']).args).toEqual(['--toggle', '--ozone-platform=x11']);
    });
});

describe('keybindExecPath', () => {
    afterEach(() => {
        delete process.env.APPIMAGE;
    });

    it('targets $APPIMAGE when running from an AppImage', () => {
        process.env.APPIMAGE = '/opt/WhisperGlass.AppImage';
        expect(keybindExecPath()).toBe('/opt/WhisperGlass.AppImage');
    });

    it('falls back to process.execPath outside AppImages', () => {
        delete process.env.APPIMAGE;
        expect(keybindExecPath()).toBe(process.execPath);
    });
});
