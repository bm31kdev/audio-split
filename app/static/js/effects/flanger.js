// A short feedback delay creates the characteristic moving comb-filter tone.
export function updateFlanger(effect, amount, context, smooth = false) {
  const depth = Math.max(0, Math.min(100, amount)) / 100, at = context.currentTime;
  const apply = (parameter, value) => smooth ? parameter.setTargetAtTime(value, at, 0.02) : parameter.setValueAtTime(value, at);
  apply(effect.wet.gain, depth * 0.55); apply(effect.feedback.gain, depth * 0.62); apply(effect.modulation.gain, depth * 0.0025);
}
export function createFlanger(context, input, amount) {
  const dry = context.createGain(), delay = context.createDelay(0.04), wet = context.createGain(), feedback = context.createGain(), modulation = context.createGain(), lfo = context.createOscillator();
  delay.delayTime.value = 0.004; lfo.frequency.value = 0.22;
  input.connect(dry); input.connect(delay).connect(wet); delay.connect(feedback).connect(delay);
  lfo.connect(modulation).connect(delay.delayTime); lfo.start();
  const effect = { dry, delay, wet, feedback, modulation, oscillators: [lfo], output: context.createGain() };
  dry.connect(effect.output); wet.connect(effect.output);
  updateFlanger(effect, amount, context); return effect;
}
