function pcm16ToWavBuffer(chunks, sampleRate = 16000) {
    let dataLen = 0;
    for (const chunk of chunks) dataLen += chunk.length;
    const buf = Buffer.alloc(44 + dataLen);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + dataLen, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(dataLen, 40);
    let offset = 44;
    for (const chunk of chunks) {
        chunk.copy(buf, offset);
        offset += chunk.length;
    }
    return buf;
}

module.exports = { pcm16ToWavBuffer };
