// A soft waveshaper gate attenuates low-level samples between vocal/drum hits.
export function updateNoiseGate(effect, amount) {
  const depth = Math.max(0, Math.min(100, amount)) / 100, threshold = depth * 0.12;
  const curve = new Float32Array(2048);
  for (let index = 0; index < curve.length; index += 1) {
    const value = index * 2 / (curve.length - 1) - 1, magnitude = Math.abs(value);
    curve[index] = magnitude <= threshold ? 0 : Math.sign(value) * Math.min(1, (magnitude - threshold) / (1 - threshold));
  }
  effect.shaper.curve = curve;
}
export function createNoiseGate(context, input, amount) {
  const shaper = context.createWaveShaper(); input.connect(shaper);
  const effect = { shaper, output: shaper }; updateNoiseGate(effect, amount); return effect;
}
