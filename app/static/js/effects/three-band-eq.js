// Three musical bands give simple tonal control to every stem.

export function updateThreeBandEq(effect, values, context, smooth = false) {
  const at = context.currentTime;
  const apply = (parameter, value) => smooth ? parameter.setTargetAtTime(value, at, 0.012) : parameter.setValueAtTime(value, at);
  apply(effect.low.gain, values.eqLow);
  apply(effect.mid.gain, values.eqMid);
  apply(effect.high.gain, values.eqHigh);
}

export function createThreeBandEq(context, input, values) {
  const low = context.createBiquadFilter();
  const mid = context.createBiquadFilter();
  const high = context.createBiquadFilter();
  low.type = 'lowshelf'; low.frequency.value = 180;
  mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.9;
  high.type = 'highshelf'; high.frequency.value = 4800;
  input.connect(low).connect(mid).connect(high);
  const effect = { low, mid, high, output: high };
  updateThreeBandEq(effect, values, context);
  return effect;
}
