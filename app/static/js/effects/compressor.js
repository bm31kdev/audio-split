// Compressor stabilizes loud peaks while leaving a zero amount transparent.

export function updateCompressor(effect, amount, context, smooth = false) {
  const intensity = Math.max(0, Math.min(100, amount));
  const at = context.currentTime;
  const apply = (parameter, value) => smooth ? parameter.setTargetAtTime(value, at, 0.012) : parameter.setValueAtTime(value, at);
  apply(effect.node.threshold, -Math.max(0, intensity * 0.42));
  apply(effect.node.ratio, 1 + intensity * 0.11);
  effect.node.knee.setValueAtTime(10, at);
  effect.node.attack.setValueAtTime(0.008, at);
  effect.node.release.setValueAtTime(0.18, at);
}

export function createCompressor(context, input, amount) {
  const node = context.createDynamicsCompressor();
  input.connect(node);
  const effect = { node, output: node };
  updateCompressor(effect, amount, context);
  return effect;
}
