// A fast high-ratio compressor keeps peaks under control.
export function updateLimiter(effect, amount, context, smooth = false) {
  const depth = Math.max(0, Math.min(100, amount)) / 100, at = context.currentTime;
  const apply = (parameter, value) => smooth ? parameter.setTargetAtTime(value, at, 0.02) : parameter.setValueAtTime(value, at);
  apply(effect.node.threshold, -3 - depth * 21); apply(effect.node.ratio, 1 + depth * 19); apply(effect.node.knee, 0); apply(effect.node.attack, 0.002); apply(effect.node.release, 0.08);
}
export function createLimiter(context, input, amount) {
  const node = context.createDynamicsCompressor(); input.connect(node);
  const effect = { node, output: node }; updateLimiter(effect, amount, context); return effect;
}
