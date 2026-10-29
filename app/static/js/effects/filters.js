// High-pass and low-pass filters are mapped to friendly 0–100 controls.

const exponential = (min, max, amount) => min * ((max / min) ** (amount / 100));

export function updateFilters(effect, values, context, smooth = false) {
  const highFrequency = exponential(20, 1000, values.highPass);
  const lowFrequency = exponential(20000, 300, values.lowPass);
  const at = context.currentTime;
  const apply = (parameter, value) => smooth ? parameter.setTargetAtTime(value, at, 0.012) : parameter.setValueAtTime(value, at);
  apply(effect.highPass.frequency, highFrequency);
  apply(effect.lowPass.frequency, lowFrequency);
}

export function createFilters(context, input, values) {
  const highPass = context.createBiquadFilter();
  const lowPass = context.createBiquadFilter();
  highPass.type = 'highpass'; highPass.Q.value = 0.7;
  lowPass.type = 'lowpass'; lowPass.Q.value = 0.7;
  input.connect(highPass).connect(lowPass);
  const effect = { highPass, lowPass, output: lowPass };
  updateFilters(effect, values, context);
  return effect;
}
