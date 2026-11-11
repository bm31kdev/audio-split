// Quantizing the waveshaper curve produces a bit-depth reduction effect.
export function updateBitcrusher(effect, amount) {
  const depth = Math.max(0, Math.min(100, amount)) / 100, steps = Math.max(4, Math.round(65536 / (1 + depth * 255)));
  const curve = new Float32Array(2048);
  for (let index = 0; index < curve.length; index += 1) { const value = index * 2 / (curve.length - 1) - 1; curve[index] = Math.round(value * steps) / steps; }
  effect.shaper.curve = curve;
}
export function createBitcrusher(context, input, amount) {
  const shaper = context.createWaveShaper(); shaper.oversample = 'none'; input.connect(shaper);
  const effect = { shaper, output: shaper }; updateBitcrusher(effect, amount); return effect;
}
