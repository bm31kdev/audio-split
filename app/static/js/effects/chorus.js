// A lightly modulated short delay adds a wider, doubled tone.
export function updateChorus(effect, amount, context, smooth = false) {
  const depth = Math.max(0, Math.min(100, amount)) / 100;
  const at = context.currentTime;
  const apply = (parameter, value) => smooth ? parameter.setTargetAtTime(value, at, 0.02) : parameter.setValueAtTime(value, at);
  apply(effect.wet.gain, depth * 0.45);
  apply(effect.modulation.gain, depth * 0.006);
}
export function createChorus(context, input, amount) {
  const dry = context.createGain(), delay = context.createDelay(0.08), wet = context.createGain();
  const modulation = context.createGain(), lfo = context.createOscillator();
  delay.delayTime.value = 0.025; lfo.frequency.value = 0.8;
  input.connect(dry); input.connect(delay).connect(wet);
  lfo.connect(modulation).connect(delay.delayTime); lfo.start();
  const effect = { dry, delay, wet, modulation, oscillators: [lfo], output: context.createGain() };
  dry.connect(effect.output); wet.connect(effect.output);
  updateChorus(effect, amount, context); return effect;
}
