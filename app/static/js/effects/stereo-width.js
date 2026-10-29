// Stereo width uses mid/side math: 100 is original width, 0 is mono, 200 is wide.

export function updateStereoWidth(effect, amount, context, smooth = false) {
  const width = Math.max(0, Math.min(200, amount)) / 100;
  const at = context.currentTime;
  const apply = (parameter, value) => smooth ? parameter.setTargetAtTime(value, at, 0.012) : parameter.setValueAtTime(value, at);
  apply(effect.sideToLeft.gain, width);
  apply(effect.sideToRight.gain, -width);
}

export function createStereoWidth(context, input, amount) {
  const splitter = context.createChannelSplitter(2);
  const merger = context.createChannelMerger(2);
  const leftToMid = context.createGain(); const rightToMid = context.createGain();
  const leftToSide = context.createGain(); const rightToSide = context.createGain();
  const midToLeft = context.createGain(); const midToRight = context.createGain();
  const sideToLeft = context.createGain(); const sideToRight = context.createGain();
  [leftToMid, rightToMid, leftToSide, rightToSide].forEach(node => { node.gain.value = 0.5; });
  rightToSide.gain.value = -0.5;
  input.connect(splitter);
  splitter.connect(leftToMid, 0); splitter.connect(rightToMid, 1);
  splitter.connect(leftToSide, 0); splitter.connect(rightToSide, 1);
  leftToMid.connect(midToLeft); rightToMid.connect(midToLeft);
  leftToMid.connect(midToRight); rightToMid.connect(midToRight);
  leftToSide.connect(sideToLeft); rightToSide.connect(sideToLeft);
  leftToSide.connect(sideToRight); rightToSide.connect(sideToRight);
  // connect(destination, output, input): the merger has one output but two inputs.
  midToLeft.connect(merger, 0, 0);
  sideToLeft.connect(merger, 0, 0);
  midToRight.connect(merger, 0, 1);
  sideToRight.connect(merger, 0, 1);
  const effect = { sideToLeft, sideToRight, output: merger };
  updateStereoWidth(effect, amount, context);
  return effect;
}
