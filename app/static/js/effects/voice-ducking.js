// Voice ducking lowers instrumental stems when vocal energy crosses the threshold.

function targetGain(level, amount) {
  const activity = Math.min(1, level * 3.2);
  return 1 - activity * (Math.max(0, Math.min(100, amount)) / 100) * 0.5;
}

export function createVoiceDucker(context, input) {
  const gain = context.createGain();
  input.connect(gain);
  return { gain };
}

export function updateVoiceDucking(effect, level, amount, context, smooth = true) {
  const value = targetGain(level, amount);
  if (smooth) effect.gain.gain.setTargetAtTime(value, context.currentTime, 0.03);
  else effect.gain.gain.setValueAtTime(value, context.currentTime);
}

export function createVoiceMeter(context, input) {
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  input.connect(analyser);
  return { analyser, data: new Float32Array(analyser.fftSize) };
}

export function readVoiceLevel(meter) {
  meter.analyser.getFloatTimeDomainData(meter.data);
  const energy = meter.data.reduce((sum, sample) => sum + sample * sample, 0) / meter.data.length;
  return Math.sqrt(energy);
}

export function scheduleOfflineVoiceDucking(effect, vocalBuffer, amount, context) {
  const channel = vocalBuffer.getChannelData(0);
  const step = Math.max(1, Math.floor(vocalBuffer.sampleRate * 0.04));
  for (let start = 0; start < channel.length; start += step) {
    let energy = 0;
    const end = Math.min(channel.length, start + step);
    for (let index = start; index < end; index += 1) energy += channel[index] * channel[index];
    const level = Math.sqrt(energy / Math.max(1, end - start));
    effect.gain.gain.setValueAtTime(targetGain(level, amount), start / vocalBuffer.sampleRate);
  }
}
