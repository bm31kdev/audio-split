// Encoding a full mix can take long enough to freeze the page, so PCM work
// happens in a dedicated worker while playback controls remain responsive.
self.onmessage = ({ data }) => {
  try {
    const { channels, sampleRate } = data;
    if (!Array.isArray(channels) || channels.length !== 2 || !Number.isFinite(sampleRate)) {
      throw new Error('The stereo render data is invalid.');
    }
    const sampleCount = channels[0].length;
    if (channels.some(channel => channel.length !== sampleCount)) throw new Error('Stereo channels have different lengths.');
    const dataBytes = sampleCount * channels.length * 2;
    if (dataBytes + 36 > 0xffffffff) throw new Error('WAV export exceeds the 4 GiB RIFF limit.');

    let peak = 0;
    for (const channel of channels) for (let index = 0; index < sampleCount; index += 1) peak = Math.max(peak, Math.abs(channel[index]));
    const gain = peak > 0.98 ? 0.98 / peak : 1;
    const output = new ArrayBuffer(44 + dataBytes), view = new DataView(output);
    const write = (offset, text) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
    write(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); write(8, 'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true);
    view.setUint16(32, 4, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, dataBytes, true);
    let offset = 44;
    for (let index = 0; index < sampleCount; index += 1) {
      for (let channel = 0; channel < 2; channel += 1) {
        const sample = Math.max(-1, Math.min(1, channels[channel][index] * gain));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    self.postMessage({ blob: new Blob([output], { type: 'audio/wav' }), normalized: gain < 1 });
  } catch (error) {
    self.postMessage({ error: error.message || String(error) });
  }
};
