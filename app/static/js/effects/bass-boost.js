// Bass boost uses a linear low-shelf filter; it does not add harmonic distortion.
export function updateBassBoost(effect, amount, context, smooth = false) {
  const percent = Math.max(0, Math.min(100, Number(amount) || 0));
  const gainDb = percent * 0.12;
  const parameter = effect.shelf.gain;
  if (smooth) parameter.setTargetAtTime(gainDb, context.currentTime, 0.018);
  else parameter.setValueAtTime(gainDb, context.currentTime);
}

export function createBassBoost(context, input, amount) {
  const shelf = context.createBiquadFilter();
  shelf.type = 'lowshelf';
  shelf.frequency.value = 110;
  input.connect(shelf);
  const effect = { shelf, output: shelf };
  updateBassBoost(effect, amount, context);
  return effect;
}
