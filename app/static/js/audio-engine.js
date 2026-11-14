import { createBassSaturation, updateBassSaturation } from './effects/bass-saturation.js?v=1.3.6.1';
import { createBassBoost, updateBassBoost } from './effects/bass-boost.js?v=1.3.6.1';
import { createCompressor, updateCompressor } from './effects/compressor.js?v=1.3.6.1';
import { createThreeBandEq, updateThreeBandEq } from './effects/three-band-eq.js?v=1.3.6.1';
import { createReverb, updateReverb } from './effects/reverb.js?v=1.3.6.1';
import { createDelay, updateDelay } from './effects/delay.js?v=1.3.6.1';
import { createFilters, updateFilters } from './effects/filters.js?v=1.3.6.1';
import { createStereoWidth, updateStereoWidth } from './effects/stereo-width.js?v=1.3.6.1';
import { createChorus, updateChorus } from './effects/chorus.js?v=1.3.6.1';
import { createFlanger, updateFlanger } from './effects/flanger.js?v=1.3.6.1';
import { createPhaser, updatePhaser } from './effects/phaser.js?v=1.3.6.1';
import { createTremolo, updateTremolo } from './effects/tremolo.js?v=1.3.6.1';
import { createBitcrusher, updateBitcrusher } from './effects/bitcrusher.js?v=1.3.6.1';
import { createNoiseGate, scheduleOfflineNoiseGate, updateNoiseGate } from './effects/noise-gate.js?v=1.3.6.1';
import { createDeEsser, scheduleOfflineDeEsser, updateDeEsser } from './effects/de-esser.js?v=1.3.6.1';
import { createLimiter, updateLimiter } from './effects/limiter.js?v=1.3.6.1';
import { createExciter, updateExciter } from './effects/exciter.js?v=1.3.6.1';
import { effectCatalog, effectIsAvailable } from './effects/catalog.js?v=1.3.6.1';
import { createVoiceDucker, createVoiceMeter, readVoiceLevel, scheduleOfflineVoiceDucking, updateVoiceDucking } from './effects/voice-ducking.js?v=1.3.6.1';
import { getLanguage, t } from './i18n.js?v=1.3.6.1';

// Small DOM helper kept in the entry module so the UI code stays readable.
export const $ = (sel) => document.querySelector(sel);
export const tracks = {};
export const automationByTrack = {};
export const effectDefaults = { saturation: 0, bassBoost: 0, compressor: 0, eqLow: 0, eqMid: 0, eqHigh: 0, reverb: 0, delay: 0, highPass: 0, lowPass: 0, width: 100, ducking: 0, chorus: 0, flanger: 0, phaser: 0, tremolo: 0, bitcrusher: 0, gate: 0, deEsser: 0, limiter: 0, exciter: 0 };
export const MAX_DECODED_STEM_BYTES = 1024 * 1024 * 1024;
export const MAX_EXPORT_WORKING_BYTES = 2 * 1024 * 1024 * 1024;
export const WAV_RIFF_MAX_BYTES = 0xffffffff;
export const effectsByTrack = {};
export function setTrackTargets(hasBass, hasOther) { saturationTarget = hasBass ? 'bass' : 'accompaniment'; widthTarget = hasOther ? 'other' : 'accompaniment'; }
export function getSaturationTarget() { return saturationTarget; }
export function getWidthTarget() { return widthTarget; }
export let audioCtx, liveNodes = new Map(), liveMaster, playing = false, paused = false, playStartedAt = 0, playheadOffset = 0, playheadDragging = false, playheadWasPlaying = false, automationDragging = false, playheadFrame, playbackEndTimer, playbackToken = 0, saturationTarget = 'accompaniment', widthTarget = 'accompaniment', voiceMeter;

export function autosaveNotice(state, detail = '') {
  const notice = $('#autosaveStatus');
  if (!notice) return;
  const english = getLanguage() === 'en';
  const messages = {
    ready: english ? 'Autosave active · every 10 seconds' : 'Sauvegarde auto active · toutes les 10 s',
    waiting: english ? 'Save this project once to enable autosave.' : 'Enregistre le projet une fois pour activer la sauvegarde auto.',
    dirty: english ? 'Changes pending · autosave in 10 seconds' : 'Modifications en attente · sauvegarde auto sous 10 s',
    saving: english ? 'Saving project…' : 'Sauvegarde du projet…',
    saved: english ? `Project saved at ${detail}` : `Projet sauvegardé à ${detail}`,
    error: english ? `Autosave failed: ${detail}` : `Échec de la sauvegarde auto : ${detail}`,
    manualError: english ? `Could not save project: ${detail}` : `Impossible d’enregistrer le projet : ${detail}`,
  };
  notice.textContent = messages[state] || detail;
  notice.dataset.state = state;
}
export function markProjectDirty() { window.dispatchEvent(new Event('audiosplit:project-dirty')); }
export function clockTime() { return new Intl.DateTimeFormat(getLanguage() === 'en' ? 'en-US' : 'fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date()); }

export function status(message, error = false) {
  // The import card is the single place where asynchronous work reports status.
  const target = $('#status'); target.textContent = message; target.style.color = error ? '#ff987f' : '';
}
export function startSeparationProgressPolling(requestId) {
  if (separationPollTimer) clearInterval(separationPollTimer);
  separationPollTimer = setInterval(async () => {
    if (separationPollBusy || activeSeparationRequestId !== requestId) return;
    separationPollBusy = true;
    try {
      const progress = await apiJson(`/api/separations/${requestId}`);
      if (activeSeparationRequestId !== requestId) return;
      if (progress.status === 'canceling') status(t('status.canceling'));
      else if (Number.isFinite(progress.progress) && progress.progress > 0 && progress.progress < 100) status(t('status.progress', { percent: progress.progress }));
    } catch { /* The route becomes visible once the upload reaches the server handler. */ }
    finally { separationPollBusy = false; }
  }, 700);
}
export function stopSeparationProgressPolling() {
  if (separationPollTimer) clearInterval(separationPollTimer);
  separationPollTimer = undefined;
  separationPollBusy = false;
}
export function ensureAudioContext() { if (!audioCtx || audioCtx.state === 'closed') audioCtx = new AudioContext(); return audioCtx; }
export function getAudioContext() { return audioCtx; }
export function settings(name) {
  // Read the native controls on demand so live playback and offline export agree.
  const volume = +document.querySelector(`[data-control="${name}"][data-param="volume"]`).value / 100;
  const pan = +document.querySelector(`[data-control="${name}"][data-param="pan"]`).value / 100;
  return { volume, pan, muted: document.querySelector(`[data-mute="${name}"]`).getAttribute('aria-pressed') === 'true', effects: effectsByTrack[name] || { ...effectDefaults } };
}
export function updateLiveMix() {
  // Browser AudioParams are updated while the existing sources keep playing.
  if (!audioCtx || !playing) return;
  const voiceLevel = voiceMeter ? readVoiceLevel(voiceMeter) : 0;
  for (const [name, nodes] of liveNodes) {
    const cfg = settings(name), now = audioCtx.currentTime;
    nodes.gain.gain.setTargetAtTime(cfg.muted ? 0 : cfg.volume, now, 0.012);
    schedulePan(nodes.panner, name, cfg, now, Math.max(0, now - playStartedAt));
    updateTrackEffects(nodes, cfg.effects, audioCtx, voiceLevel);
  }
}
export function updateOutputs() {
  document.querySelectorAll('[data-control]').forEach(input => {
    const name = input.dataset.control, param = input.dataset.param, value = +input.value;
    const output = $(`#${name}${param === 'volume' ? 'Volume' : 'Pan'}Out`);
    output.textContent = value;
    const gauge = input.closest('.gauge');
    if (gauge) gauge.style.setProperty('--level', `${((value - +input.min) / (+input.max - +input.min)) * 100}%`);
  });
  updateLiveMix();
}
export function formatTime(seconds) { const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60); return `${m}:${String(s).padStart(2, '0')}`; }
export function tickStep(duration) { return duration <= 30 ? 5 : duration <= 90 ? 10 : duration <= 240 ? 30 : 60; }
export function getAutomationPan(name, time) {
  const points = automationByTrack[name]?.points || [];
  if (!points.length || time <= points[0].time) return points[0]?.pan || 0;
  for (let i = 1; i < points.length; i++) {
    const next = points[i], previous = points[i - 1];
    if (time <= next.time) {
      const before = points[i - 2] || previous, after = points[i + 1] || next;
      const span = next.time - previous.time, ratio = (time - previous.time) / span;
      const slopeStart = before === previous ? (next.pan - previous.pan) / span : (next.pan - before.pan) / (next.time - before.time);
      const slopeEnd = after === next ? (next.pan - previous.pan) / span : (after.pan - previous.pan) / (after.time - previous.time);
      const u2 = ratio * ratio, u3 = u2 * ratio;
      const value = (2 * u3 - 3 * u2 + 1) * previous.pan
        + (u3 - 2 * u2 + ratio) * slopeStart * span
        + (-2 * u3 + 3 * u2) * next.pan
        + (u3 - u2) * slopeEnd * span;
      return Math.max(-100, Math.min(100, value));
    }
  }
  return points.at(-1).pan;
}
export function combinedPan(pointPan, cfg) { return Math.max(-1, Math.min(1, pointPan / 100 + cfg.pan)); }
export function trackHasEffect(key, name) { return effectIsAvailable(effectCatalog.find(effect => effect.key === key), name, { saturation: saturationTarget, width: widthTarget }); }
export function disposeTrackNodes(nodes) {
  Object.values(nodes?.effects || {}).forEach(effect => effect?.oscillators?.forEach(oscillator => { try { oscillator.stop(); } catch {} }));
  Object.values(nodes?.effects || {}).forEach(effect => {
    effect?.detector?.disconnect();
    effect?.analyser?.disconnect();
    effect?.silentOutput?.disconnect();
  });
}
// Each track keeps a dry signal. Only the selected bass source gets an extra
// low-frequency saturated branch, so other stems remain untouched.
export function createTrackNodes(context, source, name, cfg, destination) {
  const gain = context.createGain();
  const panner = context.createStereoPanner();
  gain.gain.value = cfg.muted ? 0 : cfg.volume;
  source.connect(gain);

  // Serial processors shape the main signal before panning it in the mix.
  const eq = createThreeBandEq(context, gain, cfg.effects);
  const filters = createFilters(context, eq.output, cfg.effects);
  const compressor = trackHasEffect('compressor', name) ? createCompressor(context, filters.output, cfg.effects.compressor) : null;
  let processedOutput = compressor?.output || filters.output;
  const modulationEffects = {};
  for (const [key, create] of [['chorus', createChorus], ['flanger', createFlanger], ['phaser', createPhaser], ['tremolo', createTremolo], ['bitcrusher', createBitcrusher], ['gate', createNoiseGate], ['deEsser', createDeEsser], ['limiter', createLimiter], ['exciter', createExciter]]) {
    const effect = trackHasEffect(key, name) ? create(context, processedOutput, cfg.effects[key]) : null;
    if (effect) processedOutput = effect.output;
    modulationEffects[key] = effect;
  }
  const width = trackHasEffect('width', name) ? createStereoWidth(context, processedOutput, cfg.effects.width) : null;
  const widthOutput = width?.output || processedOutput;
  const bassBoost = trackHasEffect('bassBoost', name) ? createBassBoost(context, widthOutput, cfg.effects.bassBoost) : null;
  const mainOutput = bassBoost?.output || widthOutput;
  mainOutput.connect(panner);

  // Parallel processors add ambience or grit without replacing the dry track.
  const saturation = trackHasEffect('saturation', name) ? createBassSaturation(context, mainOutput, panner, cfg.effects.saturation) : null;
  const reverb = trackHasEffect('reverb', name) ? createReverb(context, mainOutput, panner, cfg.effects.reverb) : null;
  const delay = trackHasEffect('delay', name) ? createDelay(context, mainOutput, panner, cfg.effects.delay) : null;
  const ducking = name !== 'vocals' ? createVoiceDucker(context, panner) : null;
  (ducking?.gain || panner).connect(destination);

  return { gain, panner, effects: { eq, filters, compressor, width, bassBoost, saturation, reverb, delay, ducking, ...modulationEffects } };
}
export function updateTrackEffects(nodes, values, context, voiceLevel = 0) {
  updateThreeBandEq(nodes.effects.eq, values, context, true);
  updateFilters(nodes.effects.filters, values, context, true);
  if (nodes.effects.compressor) updateCompressor(nodes.effects.compressor, values.compressor, context, true);
  if (nodes.effects.width) updateStereoWidth(nodes.effects.width, values.width, context, true);
  if (nodes.effects.bassBoost) updateBassBoost(nodes.effects.bassBoost, values.bassBoost, context, true);
  if (nodes.effects.saturation) updateBassSaturation(nodes.effects.saturation, values.saturation, context, true);
  if (nodes.effects.reverb) updateReverb(nodes.effects.reverb, values.reverb, context, true);
  if (nodes.effects.delay) updateDelay(nodes.effects.delay, values.delay, context, true);
  if (nodes.effects.ducking) updateVoiceDucking(nodes.effects.ducking, voiceLevel, values.ducking, context, true);
  if (nodes.effects.chorus) updateChorus(nodes.effects.chorus, values.chorus, context, true);
  if (nodes.effects.flanger) updateFlanger(nodes.effects.flanger, values.flanger, context, true);
  if (nodes.effects.phaser) updatePhaser(nodes.effects.phaser, values.phaser, context, true);
  if (nodes.effects.tremolo) updateTremolo(nodes.effects.tremolo, values.tremolo, context, true);
  if (nodes.effects.bitcrusher) updateBitcrusher(nodes.effects.bitcrusher, values.bitcrusher);
  if (nodes.effects.gate) updateNoiseGate(nodes.effects.gate, values.gate, context, true);
  if (nodes.effects.deEsser) updateDeEsser(nodes.effects.deEsser, values.deEsser, context, true);
  if (nodes.effects.limiter) updateLimiter(nodes.effects.limiter, values.limiter, context, true);
  if (nodes.effects.exciter) updateExciter(nodes.effects.exciter, values.exciter, context, true);
}
export function schedulePan(panner, name, cfg, startAt, offset = 0, remainingDuration = timelineDuration() - offset) {
  if (typeof panner.pan.cancelAndHoldAtTime === 'function') panner.pan.cancelAndHoldAtTime(startAt);
  else panner.pan.cancelScheduledValues(startAt);
  const automation = automationByTrack[name];
  if (!automation?.points.length) { panner.pan.setValueAtTime(cfg.pan, startAt); return; }
  const duration = Math.max(0, remainingDuration);
  if (duration < 0.01) { panner.pan.setValueAtTime(combinedPan(getAutomationPan(name, offset), cfg), startAt); return; }
  const sampleCount = Math.min(8192, Math.max(2, Math.ceil(duration * 60) + 1));
  const curve = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const time = offset + duration * index / (sampleCount - 1);
    curve[index] = combinedPan(getAutomationPan(name, time), cfg);
  }
  panner.pan.setValueCurveAtTime(curve, startAt, duration);
}
export function drawWaveform(name, buffer) {
  // The waveform is drawn only on load/resize; the playhead is a lightweight CSS overlay.
  const canvas = document.querySelector(`[data-waveform="${name}"]`), ratio = devicePixelRatio || 1;
  const width = Math.max(120, canvas.clientWidth), height = Math.max(40, canvas.clientHeight);
  canvas.width = width * ratio; canvas.height = height * ratio;
  const ctx = canvas.getContext('2d'), graphHeight = height - 20; ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, height);
  const data = buffer.getChannelData(0), step = Math.max(1, Math.floor(data.length / width));
  ctx.strokeStyle = name === 'vocals' ? '#f2a9e1' : '#8cdbff'; ctx.globalAlpha = .9; ctx.lineWidth = 1;
  ctx.beginPath(); for (let x = 0; x < width; x++) { let min = 1, max = -1; const start = x * step; for (let i = 0; i < step && start + i < data.length; i++) { const value = data[start + i]; if (value < min) min = value; if (value > max) max = value; } const y1 = (1 + min) * graphHeight / 2, y2 = (1 + max) * graphHeight / 2; ctx.moveTo(x, y1); ctx.lineTo(x, y2); } ctx.stroke();
  ctx.globalAlpha = .42; ctx.strokeStyle = '#69717e'; ctx.fillStyle = '#aeb5c0'; ctx.font = '9px DM Mono, monospace'; ctx.lineWidth = 1;
  const stepSeconds = tickStep(buffer.duration); for (let t = 0; t <= buffer.duration; t += stepSeconds) { const x = (t / buffer.duration) * width; ctx.beginPath(); ctx.moveTo(x + .5, graphHeight + 1); ctx.lineTo(x + .5, graphHeight + 5); ctx.stroke(); if (x < width - 22) ctx.fillText(formatTime(t), x + 3, height - 5); }
  const automation = automationByTrack[name]; if (automation?.points.length) {
    const points = automation.points.map(point => ({ x: (point.time / buffer.duration) * width, y: graphHeight * (1 - (point.pan + 100) / 200) }));
    ctx.globalAlpha = 1; ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = 0; x < width; x += 1) {
      const time = (x / Math.max(1, width - 1)) * buffer.duration;
      const y = graphHeight * (1 - (getAutomationPan(name, time) + 100) / 200);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    points.forEach((point, index) => { ctx.fillStyle = index === automation.selected ? '#d7ff54' : '#a78bfa'; ctx.beginPath(); ctx.arc(point.x, point.y, index === automation.selected ? 5 : 4, 0, Math.PI * 2); ctx.fill(); });
  }
}
export const stemInfo = {
  vocals: { titleKey: 'stem.vocals', detailKey: 'stem.vocalsDetail', icon: 'mic' },
  accompaniment: { titleKey: 'stem.accompaniment', detailKey: 'stem.accompanimentDetail', icon: 'wave' },
  drums: { titleKey: 'stem.drums', detailKey: 'stem.drumsDetail', icon: 'drum' },
  bass: { titleKey: 'stem.bass', detailKey: 'stem.bassDetail', icon: 'bass' },
  other: { titleKey: 'stem.other', detailKey: 'stem.otherDetail', icon: 'spark' },
};
export function icon(name) {
  const paths = { mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0012 0M12 17v4M9 21h6"/>', wave: '<path d="M3 12h3l2-6 4 12 3-8 2 2h4"/>', drum: '<ellipse cx="12" cy="16" rx="7" ry="4"/><path d="M5 10v6M19 10v6M5 10c0-2 14-2 14 0M8 6l2 4m4-4-2 4"/>', bass: '<path d="M7 3v18M7 5h6l4 4-4 4H7M7 13h6l4 4-4 4H7"/>', spark: '<path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3z"/>' };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}
export function speakerIcon(muted = false) { return muted ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10v4h4l5 4V6l-5 4H5zM17 10l4 4m0-4-4 4"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10v4h4l5 4V6l-5 4H5zM17 9a4 4 0 010 6"/></svg>'; }
export function playIcon() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'; }
export function pauseIcon() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'; }
export function setTransportState(state = 'stopped') {
  const playButton = $('#playButton'), stopButton = $('#stopButton');
  const isPlaying = state === 'playing', isPaused = state === 'paused';
  const hasTracks = Object.keys(tracks).length > 0;
  playButton.disabled = !hasTracks;
  playButton.innerHTML = isPlaying ? pauseIcon() : playIcon();
  const playLabel = isPlaying ? t('pause.title') : isPaused ? t('resume.title') : t('play.title');
  playButton.setAttribute('aria-label', playLabel);
  playButton.title = playLabel;
  stopButton.disabled = !isPlaying && !isPaused;
}
export function ensureAutomation(name, duration) { automationByTrack[name] = { points: [{ time: 0, pan: 0 }, { time: duration, pan: 0 }], selected: 0 }; }
export function automationCoordinates(event, canvas) {
  const buffer = tracks[canvas.dataset.waveform], rect = canvas.getBoundingClientRect(), graphHeight = rect.height - 20;
  const y = Math.max(0, Math.min(graphHeight, event.clientY - rect.top));
  const pan = Math.max(-100, Math.min(100, Math.round((((1 - y / graphHeight) * 200) - 100) / 5) * 5));
  return { time: Math.max(0, Math.min(buffer.duration, ((event.clientX - rect.left) / rect.width) * buffer.duration)), pan };
}
export function selectAutomationPoint(event) {
  const canvas = event.currentTarget, name = canvas.dataset.waveform, { time, pan } = automationCoordinates(event, canvas), buffer = tracks[name], automation = automationByTrack[name];
  const closeIndex = automation.points.findIndex(point => Math.abs(point.time - time) < Math.max(.25, buffer.duration * .015));
  if (closeIndex >= 0) automation.selected = closeIndex;
  else { automation.points.push({ time, pan }); automation.points.sort((a, b) => a.time - b.time); automation.selected = automation.points.findIndex(point => point.time === time); }
  refreshAutomation(name);
  markProjectDirty();
}
export function moveAutomationPoint(event) {
  if (!automationDragging) return;
  const canvas = event.currentTarget, name = canvas.dataset.waveform, automation = automationByTrack[name], point = automation.points[automation.selected], { time, pan } = automationCoordinates(event, canvas), last = automation.points.length - 1;
  point.pan = pan;
  if (automation.selected > 0 && automation.selected < last) point.time = Math.max(automation.points[automation.selected - 1].time + .05, Math.min(automation.points[automation.selected + 1].time - .05, time));
  refreshAutomation(name);
  markProjectDirty();
}
export function refreshAutomation(name) {
  // Refreshing the curve also reschedules live panning from the current play time.
  const automation = automationByTrack[name], point = automation.points[automation.selected];
  document.querySelectorAll(`[data-automation-pan="${name}"]`).forEach(button => button.classList.toggle('active', point && +button.dataset.pan === point.pan));
  const time = document.querySelector(`[data-automation-time="${name}"]`); if (time && point) time.textContent = formatTime(point.time);
  if (tracks[name]) drawWaveform(name, tracks[name]);
  updateLiveMix();
}
export function bindAutomation() {
  document.querySelectorAll('[data-waveform]').forEach(canvas => { canvas.addEventListener('pointerdown', event => { selectAutomationPoint(event); automationDragging = true; canvas.setPointerCapture(event.pointerId); }); canvas.addEventListener('pointermove', moveAutomationPoint); canvas.addEventListener('pointerup', event => { automationDragging = false; canvas.releasePointerCapture(event.pointerId); }); });
  document.querySelectorAll('[data-automation-pan]').forEach(button => button.onclick = () => { const name = button.dataset.automationPan, automation = automationByTrack[name], point = automation.points[automation.selected]; if (!point) return; point.pan = +button.dataset.pan; refreshAutomation(name); markProjectDirty(); });
  document.querySelectorAll('[data-automation-remove]').forEach(remove => remove.onclick = () => { const name = remove.dataset.automationRemove, automation = automationByTrack[name]; if (automation.selected > 0 && automation.selected < automation.points.length - 1) { automation.points.splice(automation.selected, 1); automation.selected--; refreshAutomation(name); markProjectDirty(); } });
}
export let fxModalInstance;
export function setFxModal(modal) { fxModalInstance = modal; }
export function bindFxButtons() {
  // Track buttons are generated after a separation, so bind them after every render.
  document.querySelectorAll('[data-fx]').forEach(button => button.onclick = () => fxModalInstance?.open(button.dataset.fx));
}
export function timelineDuration() {
  return Math.max(0, ...Object.values(tracks).map(buffer => buffer.duration));
}
export function updatePlayheads(offset = playheadOffset) {
  const duration = timelineDuration();
  const position = duration ? Math.min(100, Math.max(0, (offset / duration) * 100)) : 0;
  document.querySelectorAll('[data-playhead]').forEach(playhead => {
    playhead.style.left = `${position}%`;
    playhead.classList.toggle('is-playing', playing);
    playhead.classList.toggle('is-ready', duration > 0);
    playhead.setAttribute('aria-valuenow', String(Math.round(position)));
    playhead.setAttribute('aria-valuetext', formatTime(offset));
  });
}
export function seekMix(offset, restartPlayback = true) {
  const duration = timelineDuration();
  if (!duration) return;
  playheadOffset = Math.min(Math.max(0, duration - 0.02), Math.max(0, offset));
  updatePlayheads(playheadOffset);
  if (!restartPlayback || !playing || !audioCtx) return;

  // Recreate every source at the same offset so all stems stay aligned.
  try {
    playbackToken += 1;
    if (playheadFrame) cancelAnimationFrame(playheadFrame);
    playheadFrame = undefined;
    voiceMeter = undefined;
    liveNodes.forEach(({ source, effects }) => {
      source.onended = null;
      try { source.stop(); } catch {}
      disposeTrackNodes({ effects });
    });
    liveNodes = new Map();
    liveMaster?.disconnect();
    liveMaster = undefined;
    playStartedAt = audioCtx.currentTime - playheadOffset;
    startPlaybackSources(playheadOffset);
    updatePlayheads(playheadOffset);
    if (!paused) playheadFrame = requestAnimationFrame(animatePlayheads);
  } catch (error) {
    console.error('Could not seek the live mix.', error);
    stop();
    status(t('status.playbackStart'), true);
  }
}
export function seekFromPlayhead(event, playhead) {
  const rect = playhead.parentElement.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  seekMix(ratio * timelineDuration(), false);
}
export function bindPlayheadSeeking() {
  document.querySelectorAll('[data-playhead]').forEach(playhead => {
    playhead.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      playheadDragging = true;
      playheadWasPlaying = playing;
      playhead.setPointerCapture(event.pointerId);
      seekFromPlayhead(event, playhead);
    });
    playhead.addEventListener('pointermove', event => {
      if (playheadDragging) seekFromPlayhead(event, playhead);
    });
    const finishDrag = event => {
      if (!playheadDragging) return;
      playheadDragging = false;
      try { playhead.releasePointerCapture(event.pointerId); } catch {}
      if (playheadWasPlaying) seekMix(playheadOffset, true);
      playheadWasPlaying = false;
    };
    playhead.addEventListener('pointerup', finishDrag);
    playhead.addEventListener('pointercancel', finishDrag);
    playhead.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const duration = timelineDuration();
      const step = event.shiftKey ? 10 : 5;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? duration : playheadOffset + (event.key === 'ArrowRight' ? step : -step);
      seekMix(next);
    });
  });
}
export function startPlaybackSources(offset = playheadOffset) {
  const token = playbackToken;
  const entries = Object.entries(tracks);
  let completedSources = 0;
  if (playbackEndTimer) clearTimeout(playbackEndTimer);
  playbackEndTimer = undefined;
  liveMaster = createMasterLimiter(audioCtx);
  for (const [name, buffer] of entries) {
    const source = audioCtx.createBufferSource(), cfg = settings(name), nodes = createTrackNodes(audioCtx, source, name, cfg, liveMaster);
    source.buffer = buffer;
    schedulePan(nodes.panner, name, cfg, audioCtx.currentTime, offset, Math.max(0, buffer.duration - offset));
    source.onended = () => {
      if (token !== playbackToken) return;
      completedSources += 1;
      if (completedSources === entries.length) {
        playbackEndTimer = setTimeout(() => { if (token === playbackToken) stop(); }, effectTailSeconds() * 1000);
      }
    };
    const sourceOffset = Math.min(offset, Math.max(0, buffer.duration - 1 / buffer.sampleRate));
    source.start(0, sourceOffset);
    liveNodes.set(name, { source, ...nodes });
  }
  if (liveNodes.has('vocals')) voiceMeter = createVoiceMeter(audioCtx, liveNodes.get('vocals').gain);
}
export function createMasterLimiter(context) {
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.setValueAtTime(-1, context.currentTime);
  limiter.knee.setValueAtTime(0, context.currentTime);
  limiter.ratio.setValueAtTime(20, context.currentTime);
  limiter.attack.setValueAtTime(0.003, context.currentTime);
  limiter.release.setValueAtTime(0.16, context.currentTime);
  limiter.connect(context.destination);
  return limiter;
}
export function effectTailSeconds() {
  let tail = 0;
  for (const name of Object.keys(tracks)) {
    const values = effectsByTrack[name] || effectDefaults;
    if (values.reverb > 0 && trackHasEffect('reverb', name)) tail = Math.max(tail, 1.7);
    if (values.delay > 0 && trackHasEffect('delay', name)) tail = Math.max(tail, 4.5);
  }
  return tail;
}
export function animatePlayheads() {
  if (!playing || !audioCtx) { playheadFrame = undefined; updatePlayheads(); return; }
  if (paused) { playheadFrame = undefined; updatePlayheads(playheadOffset); return; }
  try {
    // Ducking shares the animation clock with the playhead to avoid another loop.
    const voiceLevel = voiceMeter ? readVoiceLevel(voiceMeter) : 0;
    for (const [name, nodes] of liveNodes) {
      if (nodes.effects.ducking) updateVoiceDucking(nodes.effects.ducking, voiceLevel, settings(name).effects.ducking, audioCtx, true);
      if (nodes.effects.deEsser) updateDeEsser(nodes.effects.deEsser, settings(name).effects.deEsser, audioCtx, true);
      if (nodes.effects.gate) updateNoiseGate(nodes.effects.gate, settings(name).effects.gate, audioCtx, true);
    }
    if (!playheadDragging) playheadOffset = Math.min(timelineDuration(), Math.max(0, audioCtx.currentTime - playStartedAt));
    updatePlayheads(playheadOffset);
    playheadFrame = requestAnimationFrame(animatePlayheads);
  } catch (error) {
    console.error('Live mixer update failed.', error);
    stop();
    status(t('status.playbackChange'), true);
  }
}
export async function apiJson(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...options, headers });
  const body = await response.text();
  let data = {};
  try { data = body ? JSON.parse(body) : {}; }
  catch { if (!response.ok) throw new Error(body.slice(0, 400) || `HTTP ${response.status}`); throw new Error('The server returned an invalid response.'); }
  if (!response.ok) throw new Error(data?.detail || `HTTP ${response.status}`);
  return data;
}

export function stop() {
  playbackToken += 1;
  if (playbackEndTimer) clearTimeout(playbackEndTimer);
  playbackEndTimer = undefined;
  if (playheadFrame) cancelAnimationFrame(playheadFrame);
  playheadFrame = undefined;
  voiceMeter = undefined;
  liveNodes.forEach(({ source, effects }) => {
    source.onended = null;
    try { source.stop(); } catch {}
    disposeTrackNodes({ effects });
  });
  liveNodes = new Map();
  liveMaster?.disconnect();
  liveMaster = undefined;
  playing = false;
  paused = false;
  playheadOffset = 0;
  updatePlayheads();
  setTransportState();
}
export async function playMix() {
  if (playing && audioCtx) {
    try {
      if (paused || audioCtx.state !== 'running') {
        await audioCtx.resume();
        if (audioCtx.state !== 'running') throw new Error('The audio context did not resume.');
        paused = false;
        setTransportState('playing');
        playheadFrame ??= requestAnimationFrame(animatePlayheads);
      } else {
        await audioCtx.suspend();
        paused = true;
        setTransportState('paused');
        playheadOffset = Math.max(0, audioCtx.currentTime - playStartedAt);
        updatePlayheads(playheadOffset);
      }
    } catch (error) {
      console.error('Could not change playback state.', error);
      status(t('status.playbackChange'), true);
    }
    return;
  }

  if (!Object.keys(tracks).length) return;
  const startOffset = playheadOffset;
  stop();
  playheadOffset = startOffset;
  try {
    ensureAudioContext();
    // A context created after a long Demucs task is commonly suspended by Chrome.
    await audioCtx.resume();
    if (audioCtx.state !== 'running') throw new Error('The audio context did not resume.');
    playStartedAt = audioCtx.currentTime - playheadOffset;
    playbackToken += 1;
    playing = true;
    paused = false;
    setTransportState('playing');
    startPlaybackSources(playheadOffset);
    updatePlayheads(playheadOffset);
    playheadFrame = requestAnimationFrame(animatePlayheads);
  } catch (error) {
    stop();
    console.error('Audio playback could not start.', error);
    status(t('status.playbackStart'), true);
  }
}
