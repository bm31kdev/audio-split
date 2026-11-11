// Four swept all-pass filters create a classic phase-shift movement.
export function updatePhaser(effect, amount, context, smooth = false) {
  const depth = Math.max(0, Math.min(100, amount)) / 100, at = context.currentTime;
  const apply = (parameter, value) => smooth ? parameter.setTargetAtTime(value, at, 0.02) : parameter.setValueAtTime(value, at);
  apply(effect.wet.gain, depth * 0.7); apply(effect.modulation.gain, depth * 1400);
}
export function createPhaser(context, input, amount) {
  const dry = context.createGain(), wet = context.createGain(), modulation = context.createGain(), lfo = context.createOscillator();
  const stages = Array.from({ length: 4 }, (_, index) => { const filter = context.createBiquadFilter(); filter.type = 'allpass'; filter.frequency.value = 350 * (index + 1); filter.Q.value = 0.7; return filter; });
  input.connect(dry); input.connect(stages[0]); stages.forEach((stage, index) => { if (index < stages.length - 1) stage.connect(stages[index + 1]); }); stages.at(-1).connect(wet);
  lfo.frequency.value = 0.35; lfo.connect(modulation); stages.forEach(stage => modulation.connect(stage.frequency)); lfo.start();
  const effect = { dry, wet, modulation, stages, oscillators: [lfo], output: context.createGain() };
  dry.connect(effect.output); wet.connect(effect.output);
  updatePhaser(effect, amount, context); return effect;
}
