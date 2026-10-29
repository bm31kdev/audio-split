// Delay is a tempo-neutral short echo with feedback held below runaway levels.

export function updateDelay(effect, amount, context, smooth = false) {
  const wetLevel = (Math.max(0, Math.min(100, amount)) / 100) * 0.42;
  if (smooth) effect.wet.gain.setTargetAtTime(wetLevel, context.currentTime, 0.012);
  else effect.wet.gain.setValueAtTime(wetLevel, context.currentTime);
}

export function createDelay(context, input, output, amount) {
  const delay = context.createDelay(1);
  const feedback = context.createGain();
  const wet = context.createGain();
  delay.delayTime.value = 0.28;
  feedback.gain.value = 0.34;
  input.connect(delay).connect(wet).connect(output);
  delay.connect(feedback).connect(delay);
  const effect = { delay, feedback, wet };
  updateDelay(effect, amount, context);
  return effect;
}
