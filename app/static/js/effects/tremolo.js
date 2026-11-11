// An oscillator modulates gain for rhythmic volume movement.
export function updateTremolo(effect, amount, context, smooth = false) {
  const depth = Math.max(0, Math.min(100, amount)) / 100, at = context.currentTime;
  const apply = (parameter, value) => smooth ? parameter.setTargetAtTime(value, at, 0.02) : parameter.setValueAtTime(value, at);
  apply(effect.base.gain, 1 - depth * 0.45); apply(effect.modulation.gain, depth * 0.45);
}
export function createTremolo(context, input, amount) {
  const base = context.createGain(), modulation = context.createGain(), lfo = context.createOscillator(), output = context.createGain();
  lfo.frequency.value = 4; lfo.connect(modulation).connect(base.gain); input.connect(base).connect(output); lfo.start();
  const effect = { base, modulation, oscillators: [lfo], output };
  updateTremolo(effect, amount, context); return effect;
}
