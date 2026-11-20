// Analyze a small local preview of an imported song without uploading it.
const ANALYSIS_RATE = 11025;
const ANALYSIS_SECONDS = 90;

function readWaveFormat(fileBuffer) {
  const view = new DataView(fileBuffer);
  const ascii = (offset, length) => String.fromCharCode(...new Uint8Array(fileBuffer, offset, length));
  if (view.byteLength < 12 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') return null;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunk = ascii(offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (chunk === 'fmt ' && size >= 16 && offset + 8 + size <= view.byteLength) {
      return {
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitDepth: view.getUint16(offset + 22, true),
      };
    }
    offset += 8 + size + (size & 1);
  }
  return null;
}

function dbfs(value) {
  return value > 0 ? Math.max(-120, 20 * Math.log10(value)) : -120;
}

function getAnalysisSamples(audioBuffer) {
  const sourceRate = audioBuffer.sampleRate;
  const stride = Math.max(1, sourceRate / ANALYSIS_RATE);
  const sampleCount = Math.min(Math.floor(audioBuffer.duration * ANALYSIS_RATE), ANALYSIS_RATE * ANALYSIS_SECONDS);
  const mono = new Float32Array(sampleCount);
  const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) => audioBuffer.getChannelData(index));
  let squareSum = 0, peak = 0, observed = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const sourceIndex = Math.min(Math.floor(i * stride), channels[0].length - 1);
    let mixed = 0;
    for (const channel of channels) {
      const sample = channel[sourceIndex] || 0;
      mixed += sample;
      peak = Math.max(peak, Math.abs(sample));
      squareSum += sample * sample;
      observed += 1;
    }
    mono[i] = mixed / channels.length;
  }
  return { mono, peakDbfs: dbfs(peak), rmsDbfs: dbfs(Math.sqrt(squareSum / Math.max(1, observed))) };
}

export async function analyzeAudioFile(file, audioContext, onProgress = () => {}) {
  let bytes = await file.arrayBuffer();
  const wave = readWaveFormat(bytes);
  onProgress('decoding');
  let decoded = await audioContext.decodeAudioData(bytes.slice(0));
  const { mono, peakDbfs, rmsDbfs } = getAnalysisSamples(decoded);
  const metadata = {
    duration: decoded.duration,
    channels: decoded.numberOfChannels,
    sampleRate: decoded.sampleRate,
    bitDepth: wave?.bitDepth ?? null,
    peakDbfs,
    rmsDbfs,
  };
  decoded = null;
  bytes = null;
  onProgress('analyzing');
  const worker = new Worker(new URL('./music-analysis-worker.js?v=1.5.0.59', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve({ ...metadata, ...data });
    };
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || 'Music analysis failed.')); };
    worker.postMessage({ samples: mono, sampleRate: ANALYSIS_RATE }, [mono.buffer]);
  });
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function formatDbfs(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} dBFS` : '—';
}
