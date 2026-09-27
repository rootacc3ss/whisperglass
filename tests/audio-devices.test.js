import { describe, it, expect } from 'vitest';
import { sortAudioInputs, deviceRank } from '../src/utils/audio-devices.js';

describe('sortAudioInputs', () => {
    it('orders internal first, bluetooth last', () => {
        const devices = [
            { deviceId: 'a', label: 'Bose QC Ultra Headphones' },
            { deviceId: 'b', label: 'Family 17h (Ryzen HD Audio Controller) Analog Stereo' },
            { deviceId: 'c', label: 'Some Other Mic' },
            { deviceId: 'd', label: 'HD Pro Webcam C920' },
        ];
        const sorted = sortAudioInputs(devices);
        expect(sorted.map((d) => d.deviceId)).toEqual(['b', 'd', 'c', 'a']);
    });

    it('drops default/communications pseudo-devices', () => {
        const devices = [
            { deviceId: 'default', label: 'Default' },
            { deviceId: 'communications', label: 'Communications' },
            { deviceId: 'real', label: 'Internal Mic' },
        ];
        const sorted = sortAudioInputs(devices);
        expect(sorted.map((d) => d.deviceId)).toEqual(['real']);
    });

    it('handles missing labels', () => {
        const devices = [{ deviceId: 'x', label: '' }];
        const sorted = sortAudioInputs(devices);
        expect(sorted).toHaveLength(1);
    });

    it('does not mutate the input array', () => {
        const devices = [
            { deviceId: 'a', label: 'Bluetooth Headset' },
            { deviceId: 'b', label: 'Internal' },
        ];
        sortAudioInputs(devices);
        expect(devices[0].deviceId).toBe('a');
    });
});

describe('deviceRank', () => {
    it('ranks internal lowest', () => {
        expect(deviceRank({ label: 'ALC289 Analog' })).toBe(1);
        expect(deviceRank({ label: 'Ryzen HD Audio Controller Analog Stereo' })).toBe(1);
    });
    it('ranks bluetooth highest', () => {
        expect(deviceRank({ label: 'Bose QC Ultra Headphones' })).toBe(4);
        expect(deviceRank({ label: 'bluez something' })).toBe(4);
    });
});
