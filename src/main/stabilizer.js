const SKIP_MARGIN = 0.5;
const TIME_TOLERANCE = 2.5;
const MAX_QUEUE = 500;
const TRIM_TO = 350;

function normalizeWord(word) {
    return String(word || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}']/gu, '');
}

class LiveStabilizer {
    constructor() {
        this.reset();
    }

    reset() {
        this.queue = [];
        this.confirmedCount = 0;
    }

    push(rawWords, windowStartSec) {
        const words = (rawWords || [])
            .filter((w) => w && w.word && typeof w.start === 'number')
            .map((w) => ({
                word: String(w.word).trim(),
                start: windowStartSec + w.start,
                end: windowStartSec + (typeof w.end === 'number' ? w.end : w.start),
            }))
            .filter((w) => w.word);

        let ptr = 0;
        while (ptr < this.queue.length && this.queue[ptr].end <= windowStartSec - SKIP_MARGIN) {
            ptr += 1;
        }
        let j = 0;
        while (
            j < words.length &&
            ptr < this.queue.length &&
            normalizeWord(this.queue[ptr].word) === normalizeWord(words[j].word) &&
            Math.abs(this.queue[ptr].start - words[j].start) < TIME_TOLERANCE
        ) {
            ptr += 1;
            j += 1;
        }

        this.queue = this.queue.slice(0, ptr).concat(words.slice(j));
        this.confirmedCount = ptr;

        if (this.queue.length > MAX_QUEUE) {
            const drop = this.queue.length - TRIM_TO;
            this.queue = this.queue.slice(drop);
            this.confirmedCount = Math.max(0, this.confirmedCount - drop);
        }

        return {
            confirmed: this.queue.slice(0, this.confirmedCount).map((w) => w.word).join(' '),
            partial: this.queue.slice(this.confirmedCount).map((w) => w.word).join(' '),
        };
    }
}

module.exports = { LiveStabilizer, normalizeWord };
