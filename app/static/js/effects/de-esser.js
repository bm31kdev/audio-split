// A controlled high-shelf cut softens sharp vocal sibilance.
export function updateDeEsser(effect, amount, context, smooth = false) {
  const depth = Math.max(0, Math.min(100, amount)) / 100, at = context.currentTime;
  if (smooth) effect.filter.gain.setTargetAtTime(-depth * 12, at, 0.02); else effect.filter.gain.setValueAtTime(-depth * 12, at);
}
export function createDeEsser(context, input, amount) {
  const filter = context.createBiquadFilter(); filter.type = 'highshelf'; filter.frequency.value = 5200; input.connect(filter);
  const effect = { filter, output: filter }; updateDeEsser(effect, amount, context); return effect;
}
