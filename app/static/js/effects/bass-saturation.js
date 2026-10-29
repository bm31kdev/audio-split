// Bass saturation adds a distorted low-frequency parallel branch.

function buildSaturationCurve(amount) {
  const size = 2048;
  const curve = new Float32Array(size);
  const drive = 1 + Math.max(0, Math.min(100, amount)) * 0.3;
  const normalizer = Math.tanh(drive);

  for (let index = 0; index < size; index += 1) {
    const sample = (index * 2 / (size - 1)) - 1;
    curve[index] = Math.tanh(drive * sample) / normalizer;
  }

  return curve;
}

export function updateBassSaturation(effect, amount, context, smooth = false) {
  const intensity = Math.max(0, Math.min(100, amount));
  const wetLevel = (intensity / 100) * 0.36;
  effect.shaper.curve = buildSaturationCurve(intensity);
  if (smooth) effect.wet.gain.setTargetAtTime(wetLevel, context.currentTime, 0.012);
  else effect.wet.gain.setValueAtTime(wetLevel, context.currentTime);
}

export function createBassSaturation(context, input, output, amount) {
  const filter = context.createBiquadFilter();
  const shaper = context.createWaveShaper();
  const wet = context.createGain();
  filter.type = 'lowpass';
  filter.frequency.value = 240;
  filter.Q.value = 0.8;
  shaper.oversample = '4x';
  input.connect(filter).connect(shaper).connect(wet).connect(output);
  const effect = { filter, shaper, wet };
  updateBassSaturation(effect, amount, context);
  return effect;
}
