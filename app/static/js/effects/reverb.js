// Reverb uses a generated impulse response, so no external audio asset is needed.

function createImpulse(context) {
  const seconds = 1.6;
  const buffer = context.createBuffer(2, Math.floor(context.sampleRate * seconds), context.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      const envelope = (1 - index / data.length) ** 2.8;
      data[index] = (Math.random() * 2 - 1) * envelope;
    }
  }
  return buffer;
}

export function updateReverb(effect, amount, context, smooth = false) {
  const wetLevel = (Math.max(0, Math.min(100, amount)) / 100) * 0.45;
  if (smooth) effect.wet.gain.setTargetAtTime(wetLevel, context.currentTime, 0.012);
  else effect.wet.gain.setValueAtTime(wetLevel, context.currentTime);
}

export function createReverb(context, input, output, amount) {
  const convolver = context.createConvolver();
  const wet = context.createGain();
  convolver.buffer = createImpulse(context);
  input.connect(convolver).connect(wet).connect(output);
  const effect = { convolver, wet };
  updateReverb(effect, amount, context);
  return effect;
}
