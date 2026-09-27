import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Logger } from '../src/main/logger.js';

let tmp;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-log-'));
});

describe('Logger', () => {
    it('writes info lines regardless of verbose flag', () => {
        const file = path.join(tmp, 'a.log');
        const logger = new Logger(file, { isVerbose: () => false });
        logger.scope('test').info('hello', { a: 1 });
        const content = fs.readFileSync(file, 'utf8');
        expect(content).toContain('[INFO] [test] hello {"a":1}');
    });

    it('skips debug lines when verbose is off', () => {
        const file = path.join(tmp, 'b.log');
        const logger = new Logger(file, { isVerbose: () => false });
        logger.scope('test').debug('secret');
        expect(fs.existsSync(file)).toBe(false);
    });

    it('writes debug lines when verbose is on', () => {
        const file = path.join(tmp, 'c.log');
        const logger = new Logger(file, { isVerbose: () => true });
        logger.scope('test').debug('verbose line');
        expect(fs.readFileSync(file, 'utf8')).toContain('[DEBUG] [test] verbose line');
    });

    it('truncates long data payloads', () => {
        const file = path.join(tmp, 'd.log');
        const logger = new Logger(file, { isVerbose: () => true });
        logger.scope('test').info('big', { blob: 'x'.repeat(5000) });
        const content = fs.readFileSync(file, 'utf8');
        expect(content.length).toBeLessThan(2200);
        expect(content).toContain('…');
    });

    it('rotates when the file exceeds the size cap', () => {
        const file = path.join(tmp, 'e.log');
        const logger = new Logger(file, { isVerbose: () => true });
        for (let i = 0; i < 30; i++) {
            logger.scope('t').info('filler line', { pad: 'y'.repeat(1000) });
        }
        expect(fs.existsSync(file)).toBe(true);
        const stat = fs.statSync(file);
        expect(stat.size).toBeLessThan(3 * 1024 * 1024);
    });

    it('tail returns the last N lines', () => {
        const file = path.join(tmp, 'f.log');
        const logger = new Logger(file, { isVerbose: () => true });
        for (let i = 1; i <= 10; i++) logger.scope('t').info(`line ${i}`);
        const tail = logger.tail(3);
        expect(tail.split('\n')).toHaveLength(3);
        expect(tail).toContain('line 10');
        expect(tail).not.toContain('line 7');
    });
});
