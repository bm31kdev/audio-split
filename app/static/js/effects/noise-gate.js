// A detector controls a gain envelope so quiet gaps are lowered without
// applying a hard, sample-by-sample waveshaper to the audio.
function gateGain(level, amount) {
  const depth = Math.max(0, Math.min(100, amount)) / 100;
  if (depth === 0) return 1;
  const threshold = 0.008 + depth * 0.045;
  if (level <= threshold * 0.35) return 0.08;
  if (level >= threshold) return 1;
  return 0.08 + 0.92 * (level - threshold * 0.35) / (threshold * 0.65);
}

export function updateNoiseGate(effect, amount, context, smooth = false) {
  if (!effect || !context) return;
  effect.analyser.getFloatTimeDomainData(effect.samples);
  const energy = effect.samples.reduce((sum, sample) => sum + sample * sample, 0);
  const level = Math.sqrt(energy / effect.samples.length);
  const target = gateGain(level, amount), current = effect.gain.gain.value;
  const at = context.currentTime, timeConstant = target > current ? 0.006 : 0.09;
  if (smooth) effect.gain.gain.setTargetAtTime(target, at, timeConstant);
  else effect.gain.gain.setValueAtTime(target, at);
}

export function createNoiseGate(context, input, amount) {
  const gain = context.createGain();
  input.connect(gain);
  const detector = context.createAnalyser();
  detector.fftSize = 512;
  const silentOutput = context.createGain();
  silentOutput.gain.value = 0;
  input.connect(detector).connect(silentOutput).connect(context.destination);
  const effect = { gain, detector, analyser: detector, samples: new Float32Array(detector.fftSize), silentOutput, output: gain };
  updateNoiseGate(effect, amount, context);
  return effect;
}

// OfflineAudioContext cannot expose analyser frames to JavaScript, so it uses
// the same RMS threshold and smooths each scheduled gain transition.
export function scheduleOfflineNoiseGate(effect, buffer, amount, context) {
  const channel = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate, windowSize = Math.max(1, Math.floor(sampleRate * 0.02));
  for (let start = 0; start < channel.length; start += windowSize) {
    const end = Math.min(channel.length, start + windowSize);
    let energy = 0;
    for (let index = start; index < end; index += 1) energy += channel[index] * channel[index];
    const level = Math.sqrt(energy / Math.max(1, end - start));
    const target = gateGain(level, amount);
    effect.gain.gain.setTargetAtTime(target, start / sampleRate, target > effect.gain.gain.value ? 0.006 : 0.09);
  }
}
