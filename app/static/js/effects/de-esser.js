// A high-frequency detector only lowers the shelf when sibilance is present.
export function updateDeEsser(effect, amount, context, smooth = false) {
  const depth = Math.max(0, Math.min(100, amount)) / 100;
  effect.analyser.getFloatTimeDomainData(effect.samples);
  const squareSum = effect.samples.reduce((sum, sample) => sum + sample * sample, 0);
  const level = Math.sqrt(squareSum / effect.samples.length);
  const activity = Math.max(0, Math.min(1, (level - 0.006) / 0.07));
  const cut = -depth * 18 * activity, at = context.currentTime;
  if (smooth) effect.filter.gain.setTargetAtTime(cut, at, 0.025); else effect.filter.gain.setValueAtTime(cut, at);
}
export function createDeEsser(context, input, amount) {
  const filter = context.createBiquadFilter(); filter.type = 'highshelf'; filter.frequency.value = 5200; input.connect(filter);
  const detector = context.createBiquadFilter(); detector.type = 'highpass'; detector.frequency.value = 4800; detector.Q.value = 0.7;
  const analyser = context.createAnalyser(); analyser.fftSize = 512;
  const silentOutput = context.createGain(); silentOutput.gain.value = 0;
  input.connect(detector).connect(analyser).connect(silentOutput).connect(context.destination);
  const effect = { filter, detector, analyser, samples: new Float32Array(analyser.fftSize), silentOutput, output: filter };
  updateDeEsser(effect, amount, context);
  return effect;
}

// Offline rendering has no animation frames, so estimate the same high-band
// envelope from the source and schedule shelf reduction before rendering.
export function scheduleOfflineDeEsser(effect, buffer, amount) {
  const channel = buffer.getChannelData(0), depth = Math.max(0, Math.min(100, amount)) / 100;
  const sampleRate = buffer.sampleRate, windowSize = Math.max(1, Math.floor(sampleRate * 0.02));
  const rc = 1 / (2 * Math.PI * 4800), alpha = rc / (rc + 1 / sampleRate);
  let low = 0;
  for (let start = 0; start < channel.length; start += windowSize) {
    const end = Math.min(channel.length, start + windowSize);
    let energy = 0;
    for (let index = start; index < end; index += 1) {
      low += alpha * (channel[index] - low);
      const high = channel[index] - low;
      energy += high * high;
    }
    const level = Math.sqrt(energy / Math.max(1, end - start));
    const activity = Math.max(0, Math.min(1, (level - 0.006) / 0.07));
    effect.filter.gain.setValueAtTime(-depth * 18 * activity, start / sampleRate);
  }
}
