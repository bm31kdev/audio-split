// A parallel high-frequency harmonic branch adds brightness without changing the dry path.
export function updateExciter(effect, amount, context, smooth = false) {
  const depth = Math.max(0, Math.min(100, amount)) / 100, at = context.currentTime;
  if (smooth) effect.wet.gain.setTargetAtTime(depth * 0.35, at, 0.02); else effect.wet.gain.setValueAtTime(depth * 0.35, at);
  const curve = new Float32Array(1024);
  for (let index = 0; index < curve.length; index += 1) { const value = index * 2 / (curve.length - 1) - 1; curve[index] = Math.tanh(value * (1 + depth * 7)); }
  effect.shaper.curve = curve;
}
export function createExciter(context, input, amount) {
  const dry = context.createGain(), high = context.createBiquadFilter(), shaper = context.createWaveShaper(), wet = context.createGain(), output = context.createGain();
  high.type = 'highpass'; high.frequency.value = 2200; shaper.oversample = '2x';
  input.connect(dry).connect(output); input.connect(high).connect(shaper).connect(wet).connect(output);
  const effect = { dry, high, shaper, wet, output }; updateExciter(effect, amount, context); return effect;
}
