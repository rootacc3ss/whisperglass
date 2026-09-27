import { describe, it, expect } from 'vitest';
import { LiveStabilizer, normalizeWord } from '../src/main/stabilizer.js';
import { pcm16ToWavBuffer } from '../src/main/wav.js';

const w = (word, start, end) => ({ word, start, end });

describe('normalizeWord', () => {
    it('lowercases and strips punctuation', () => {
        expect(normalizeWord('Hello,')).toBe('hello');
        expect(normalizeWord('WORLD!')).toBe('world');
        expect(normalizeWord("it's")).toBe("it's");
    });
});

describe('LiveStabilizer', () => {
    it('first pass: everything partial, nothing confirmed', () => {
        const st = new LiveStabilizer();
        const out = st.push([w('Hello', 0.5, 0.9), w('world', 1.0, 1.4)], 0);
        expect(out.confirmed).toBe('');
        expect(out.partial).toBe('Hello world');
    });

    it('second pass confirms overlapping words and keeps the new tail partial', () => {
        const st = new LiveStabilizer();
        st.push([w('Hello', 0.5, 0.9), w('world', 1.0, 1.4)], 0);
        const out = st.push(
            [w('Hello', 0.3, 0.8), w('world', 0.9, 1.3), w('this', 1.5, 1.8), w('is', 1.9, 2.1)],
            1.0
        );
        expect(out.confirmed).toBe('Hello world');
        expect(out.partial).toBe('this is');
    });

    it('window slide: old words scroll out and stay confirmed', () => {
        const st = new LiveStabilizer();
        st.push([w('one', 0.5, 0.9), w('two', 1.0, 1.4), w('three', 1.5, 1.9)], 0);
        st.push([w('one', 0.4, 0.9), w('two', 1.0, 1.4), w('three', 1.5, 1.9), w('four', 2.0, 2.4)], 0.5);
        const out = st.push([w('three', 0.2, 0.7), w('four', 0.8, 1.2), w('five', 1.4, 1.8)], 2.0);
        expect(out.confirmed).toBe('one two three four');
        expect(out.partial).toBe('five');
    });

    it('tolerates punctuation and case drift between passes', () => {
        const st = new LiveStabilizer();
        st.push([w('Hello', 0.5, 0.9), w('world', 1.0, 1.4)], 0);
        const out = st.push([w('hello,', 0.4, 0.9), w('WORLD!', 1.0, 1.5)], 0.8);
        expect(out.confirmed).toBe('Hello world');
        expect(out.partial).toBe('');
    });

    it('empty new pass clears the pending tail but keeps confirmed', () => {
        const st = new LiveStabilizer();
        st.push([w('Hello', 0.5, 0.9), w('world', 1.0, 1.4)], 0);
        st.push([w('Hello', 0.3, 0.8), w('world', 0.9, 1.3), w('this', 1.5, 1.8)], 1.0);
        const out = st.push([], 3.0);
        expect(out.confirmed).toBe('Hello world');
        expect(out.partial).toBe('');
    });

    it('reset clears everything', () => {
        const st = new LiveStabilizer();
        st.push([w('Hello', 0.5, 0.9)], 0);
        st.reset();
        const out = st.push([w('new', 0.1, 0.4)], 0);
        expect(out.confirmed).toBe('');
        expect(out.partial).toBe('new');
    });

    it('trims the queue when it grows past the cap', () => {
        const st = new LiveStabilizer();
        const many = [];
        for (let i = 0; i < 600; i++) many.push(w(`word${i}`, i * 0.5, i * 0.5 + 0.4));
        st.push(many, 0);
        expect(st.queue.length).toBeLessThanOrEqual(350);
    });
});

describe('recorder tail window (via wav header sanity)', () => {
    it('tail buffer is a valid wav regardless of slice offset', () => {
        const chunk = Buffer.alloc(3200);
        const buf = pcm16ToWavBuffer([chunk.subarray(1000), chunk]);
        expect(buf.length).toBe(44 + 3200 - 1000 + 3200);
        expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
        expect(buf.readUInt32LE(40)).toBe(3200 - 1000 + 3200);
    });
});
