// Lightweight FFT and autocorrelation helpers run off the UI thread.
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function findTempo(samples, sampleRate) {
  const frameSize = Math.max(128, Math.round(sampleRate * 0.02));
  const envelope = [];
  for (let start = 0; start + frameSize <= samples.length; start += frameSize) {
    let energy = 0;
    for (let i = start; i < start + frameSize; i += 1) energy += samples[i] * samples[i];
    envelope.push(Math.sqrt(energy / frameSize));
  }
  const onset = envelope.map((value, index) => Math.max(0, value - (envelope[index - 1] || 0)));
  const mean = onset.reduce((sum, value) => sum + value, 0) / Math.max(1, onset.length);
  for (let i = 0; i < onset.length; i += 1) onset[i] -= mean;
  const frameRate = sampleRate / frameSize;
  const minLag = Math.max(1, Math.floor(frameRate * 60 / 180));
  const maxLag = Math.ceil(frameRate * 60 / 60);
  const scores = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0, leftEnergy = 0, rightEnergy = 0;
    for (let i = lag; i < onset.length; i += 1) {
      const a = onset[i], b = onset[i - lag];
      score += a * b; leftEnergy += a * a; rightEnergy += b * b;
    }
    score /= Math.sqrt(leftEnergy * rightEnergy) || 1;
    scores.push({ lag, score });
  }
  scores.sort((a, b) => b.score - a.score);
  if (!scores.length || scores[0].score <= 0) return { bpm: null, confidence: 0 };
  const best = scores[0];
  const competing = scores.find(item => Math.abs(item.lag - best.lag) > 2) || scores[1] || best;
  const confidence = Math.max(0, Math.min(1, (best.score - competing.score * 0.65) / Math.max(0.08, best.score)));
  return { bpm: Math.round((frameRate * 60 / best.lag) * 10) / 10, confidence };
}

function fft(real, imag) {
  const length = real.length;
  for (let i = 1, j = 0; i < length; i += 1) {
    let bit = length >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]]; }
  }
  for (let size = 2; size <= length; size <<= 1) {
    const half = size >> 1, angle = -2 * Math.PI / size;
    for (let start = 0; start < length; start += size) {
      for (let k = 0; k < half; k += 1) {
        const phase = angle * k, cosine = Math.cos(phase), sine = Math.sin(phase);
        const even = start + k, odd = even + half;
        const tr = real[odd] * cosine - imag[odd] * sine;
        const ti = real[odd] * sine + imag[odd] * cosine;
        real[odd] = real[even] - tr; imag[odd] = imag[even] - ti;
        real[even] += tr; imag[even] += ti;
      }
    }
  }
}

function correlate(a, b) {
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  let numerator = 0, varianceA = 0, varianceB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] - meanA, y = b[i] - meanB;
    numerator += x * y; varianceA += x * x; varianceB += y * y;
  }
  return numerator / (Math.sqrt(varianceA * varianceB) || 1);
}

function findKey(samples, sampleRate) {
  const size = 8192, hop = 4096, chroma = new Float64Array(12);
  let frames = 0;
  const real = new Float64Array(size), imag = new Float64Array(size);
  for (let start = 0; start + size <= samples.length; start += hop) {
    real.fill(0); imag.fill(0);
    for (let i = 0; i < size; i += 1) {
      real[i] = samples[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
    }
    fft(real, imag);
    for (let bin = 1; bin < size / 2; bin += 1) {
      const frequency = bin * sampleRate / size;
      if (frequency < 65 || frequency > 4000) continue;
      const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
      const magnitude = Math.hypot(real[bin], imag[bin]);
      chroma[(midi % 12 + 12) % 12] += magnitude;
    }
    frames += 1;
  }
  if (!frames) return { key: null, confidence: 0 };
  const candidates = [];
  for (let root = 0; root < 12; root += 1) {
    for (const [mode, profile] of [['major', MAJOR_PROFILE], ['minor', MINOR_PROFILE]]) {
      const rotated = profile.map((_, index) => profile[(index - root + 12) % 12]);
      candidates.push({ key: `${NOTE_NAMES[root]} ${mode}`, score: correlate(chroma, rotated) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0], next = candidates[1];
  return { key: best.key, confidence: Math.max(0, Math.min(1, (best.score - next.score) / Math.max(0.12, Math.abs(best.score)))) };
}

function estimateMeter(samples, sampleRate, bpm) {
  if (!bpm) return { meter: null, confidence: 0 };
  const frameSize = Math.max(128, Math.round(sampleRate * 0.02)), beat = sampleRate * 60 / bpm;
  const beatEnergy = [];
  for (let position = 0; position + frameSize < samples.length; position += beat) {
    const start = Math.round(position), end = Math.min(samples.length, start + frameSize);
    let energy = 0;
    for (let i = start; i < end; i += 1) energy += samples[i] * samples[i];
    beatEnergy.push(Math.sqrt(energy / Math.max(1, end - start)));
  }
  const scores = [3, 4].map(group => {
    let accented = 0, other = 0, accents = 0, others = 0;
    beatEnergy.forEach((value, index) => {
      if (index % group === 0) { accented += value; accents += 1; }
      else { other += value; others += 1; }
    });
    return { group, contrast: accented / Math.max(1, accents) - other / Math.max(1, others) };
  }).sort((a, b) => b.contrast - a.contrast);
  const confidence = Math.max(0, Math.min(1, (scores[0].contrast - scores[1].contrast) / (Math.abs(scores[0].contrast) + 0.05)));
  return { meter: `${scores[0].group}/4`, confidence };
}

self.onmessage = ({ data }) => {
  try {
    const tempo = findTempo(data.samples, data.sampleRate);
    const key = findKey(data.samples, data.sampleRate);
    const meter = estimateMeter(data.samples, data.sampleRate, tempo.bpm);
    self.postMessage({ ...tempo, key: key.key, keyConfidence: key.confidence, meter: meter.meter, meterConfidence: meter.confidence });
  } catch (error) { self.postMessage({ error: error?.message || 'Music analysis failed.' }); }
};
