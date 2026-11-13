import { createBassSaturation, updateBassSaturation } from './js/effects/bass-saturation.js?v=1.3.3';
import { createCompressor, updateCompressor } from './js/effects/compressor.js?v=1.3.3';
import { createThreeBandEq, updateThreeBandEq } from './js/effects/three-band-eq.js?v=1.3.3';
import { createReverb, updateReverb } from './js/effects/reverb.js?v=1.3.3';
import { createDelay, updateDelay } from './js/effects/delay.js?v=1.3.3';
import { createFilters, updateFilters } from './js/effects/filters.js?v=1.3.3';
import { createStereoWidth, updateStereoWidth } from './js/effects/stereo-width.js?v=1.3.3';
import { createChorus, updateChorus } from './js/effects/chorus.js?v=1.3.3';
import { createFlanger, updateFlanger } from './js/effects/flanger.js?v=1.3.3';
import { createPhaser, updatePhaser } from './js/effects/phaser.js?v=1.3.3';
import { createTremolo, updateTremolo } from './js/effects/tremolo.js?v=1.3.3';
import { createBitcrusher, updateBitcrusher } from './js/effects/bitcrusher.js?v=1.3.3';
import { createNoiseGate, scheduleOfflineNoiseGate, updateNoiseGate } from './js/effects/noise-gate.js?v=1.3.3';
import { createDeEsser, scheduleOfflineDeEsser, updateDeEsser } from './js/effects/de-esser.js?v=1.3.3';
import { createLimiter, updateLimiter } from './js/effects/limiter.js?v=1.3.3';
import { createExciter, updateExciter } from './js/effects/exciter.js?v=1.3.3';
import { effectCatalog, effectIsAvailable } from './js/effects/catalog.js?v=1.3.3';
import { createVoiceDucker, createVoiceMeter, readVoiceLevel, scheduleOfflineVoiceDucking, updateVoiceDucking } from './js/effects/voice-ducking.js?v=1.3.3';
import { bindModalAccessibility, createChangelogModal, createFxModal, createLanguageModal, mountModalComponents } from './js/modal-manager.js?v=1.3.3';
import { applyTranslations, getLanguage, onLanguageChange, t } from './js/i18n.js?v=1.3.3';

// Small DOM helper kept in the entry module so the UI code stays readable.
const $ = (sel) => document.querySelector(sel);
const tracks = {};
const automationByTrack = {};
const effectDefaults = { saturation: 0, compressor: 0, eqLow: 0, eqMid: 0, eqHigh: 0, reverb: 0, delay: 0, highPass: 0, lowPass: 0, width: 100, ducking: 0, chorus: 0, flanger: 0, phaser: 0, tremolo: 0, bitcrusher: 0, gate: 0, deEsser: 0, limiter: 0, exciter: 0 };
const MAX_DECODED_STEM_BYTES = 1024 * 1024 * 1024;
const MAX_EXPORT_WORKING_BYTES = 2 * 1024 * 1024 * 1024;
const WAV_RIFF_MAX_BYTES = 0xffffffff;
const effectsByTrack = {};
let audioCtx, liveNodes = new Map(), liveMaster, playing = false, paused = false, playStartedAt = 0, playheadOffset = 0, playheadDragging = false, playheadWasPlaying = false, automationDragging = false, playheadFrame, playbackEndTimer, playbackToken = 0, saturationTarget = 'accompaniment', widthTarget = 'accompaniment', voiceMeter;
let fxModal, changelogModal, languageModal;
let libraryModal, currentJobId = null, currentSourceName = '', currentMode = 'simple', currentEngine = 'fast', activeProjectId = null;
let projectDirty = false, projectSaving = false, projectRevision = 0;
let activeSeparationRequestId = null, separationPollTimer, separationPollBusy = false, separationCancelRequested = false;

function autosaveNotice(state, detail = '') {
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
function markProjectDirty() {
  if (!activeProjectId && !currentJobId) return;
  projectDirty = true;
  projectRevision += 1;
  autosaveNotice(activeProjectId ? 'dirty' : 'waiting');
}
function clockTime() { return new Intl.DateTimeFormat(getLanguage() === 'en' ? 'en-US' : 'fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date()); }

function status(message, error = false) {
  // The import card is the single place where asynchronous work reports status.
  const target = $('#status'); target.textContent = message; target.style.color = error ? '#ff987f' : '';
}
function startSeparationProgressPolling(requestId) {
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
function stopSeparationProgressPolling() {
  if (separationPollTimer) clearInterval(separationPollTimer);
  separationPollTimer = undefined;
  separationPollBusy = false;
}
function settings(name) {
  // Read the native controls on demand so live playback and offline export agree.
  const volume = +document.querySelector(`[data-control="${name}"][data-param="volume"]`).value / 100;
  const pan = +document.querySelector(`[data-control="${name}"][data-param="pan"]`).value / 100;
  return { volume, pan, muted: document.querySelector(`[data-mute="${name}"]`).getAttribute('aria-pressed') === 'true', effects: effectsByTrack[name] || { ...effectDefaults } };
}
function updateLiveMix() {
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
function updateOutputs() {
  document.querySelectorAll('[data-control]').forEach(input => {
    const name = input.dataset.control, param = input.dataset.param, value = +input.value;
    const output = $(`#${name}${param === 'volume' ? 'Volume' : 'Pan'}Out`);
    output.textContent = value;
    const gauge = input.closest('.gauge');
    if (gauge) gauge.style.setProperty('--level', `${((value - +input.min) / (+input.max - +input.min)) * 100}%`);
  });
  updateLiveMix();
}
function formatTime(seconds) { const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60); return `${m}:${String(s).padStart(2, '0')}`; }
function tickStep(duration) { return duration <= 30 ? 5 : duration <= 90 ? 10 : duration <= 240 ? 30 : 60; }
function getAutomationPan(name, time) {
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
function combinedPan(pointPan, cfg) { return Math.max(-1, Math.min(1, pointPan / 100 + cfg.pan)); }
function trackHasEffect(key, name) { return effectIsAvailable(effectCatalog.find(effect => effect.key === key), name, { saturation: saturationTarget, width: widthTarget }); }
function disposeTrackNodes(nodes) {
  Object.values(nodes?.effects || {}).forEach(effect => effect?.oscillators?.forEach(oscillator => { try { oscillator.stop(); } catch {} }));
  Object.values(nodes?.effects || {}).forEach(effect => {
    effect?.detector?.disconnect();
    effect?.analyser?.disconnect();
    effect?.silentOutput?.disconnect();
  });
}
// Each track keeps a dry signal. Only the selected bass source gets an extra
// low-frequency saturated branch, so other stems remain untouched.
function createTrackNodes(context, source, name, cfg, destination) {
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
  const mainOutput = width?.output || processedOutput;
  mainOutput.connect(panner);

  // Parallel processors add ambience or grit without replacing the dry track.
  const saturation = trackHasEffect('saturation', name) ? createBassSaturation(context, mainOutput, panner, cfg.effects.saturation) : null;
  const reverb = trackHasEffect('reverb', name) ? createReverb(context, mainOutput, panner, cfg.effects.reverb) : null;
  const delay = trackHasEffect('delay', name) ? createDelay(context, mainOutput, panner, cfg.effects.delay) : null;
  const ducking = name !== 'vocals' ? createVoiceDucker(context, panner) : null;
  (ducking?.gain || panner).connect(destination);

  return { gain, panner, effects: { eq, filters, compressor, width, saturation, reverb, delay, ducking, ...modulationEffects } };
}
function updateTrackEffects(nodes, values, context, voiceLevel = 0) {
  updateThreeBandEq(nodes.effects.eq, values, context, true);
  updateFilters(nodes.effects.filters, values, context, true);
  if (nodes.effects.compressor) updateCompressor(nodes.effects.compressor, values.compressor, context, true);
  if (nodes.effects.width) updateStereoWidth(nodes.effects.width, values.width, context, true);
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
function schedulePan(panner, name, cfg, startAt, offset = 0, remainingDuration = timelineDuration() - offset) {
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
function drawWaveform(name, buffer) {
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
const stemInfo = {
  vocals: { titleKey: 'stem.vocals', detailKey: 'stem.vocalsDetail', icon: 'mic' },
  accompaniment: { titleKey: 'stem.accompaniment', detailKey: 'stem.accompanimentDetail', icon: 'wave' },
  drums: { titleKey: 'stem.drums', detailKey: 'stem.drumsDetail', icon: 'drum' },
  bass: { titleKey: 'stem.bass', detailKey: 'stem.bassDetail', icon: 'bass' },
  other: { titleKey: 'stem.other', detailKey: 'stem.otherDetail', icon: 'spark' },
};
function icon(name) {
  const paths = { mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0012 0M12 17v4M9 21h6"/>', wave: '<path d="M3 12h3l2-6 4 12 3-8 2 2h4"/>', drum: '<ellipse cx="12" cy="16" rx="7" ry="4"/><path d="M5 10v6M19 10v6M5 10c0-2 14-2 14 0M8 6l2 4m4-4-2 4"/>', bass: '<path d="M7 3v18M7 5h6l4 4-4 4H7M7 13h6l4 4-4 4H7"/>', spark: '<path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3z"/>' };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}
function speakerIcon(muted = false) { return muted ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10v4h4l5 4V6l-5 4H5zM17 10l4 4m0-4-4 4"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10v4h4l5 4V6l-5 4H5zM17 9a4 4 0 010 6"/></svg>'; }
function playIcon() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'; }
function pauseIcon() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'; }
function setTransportState(state = 'stopped') {
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
function ensureAutomation(name, duration) { automationByTrack[name] = { points: [{ time: 0, pan: 0 }, { time: duration, pan: 0 }], selected: 0 }; }
function automationCoordinates(event, canvas) {
  const buffer = tracks[canvas.dataset.waveform], rect = canvas.getBoundingClientRect(), graphHeight = rect.height - 20;
  const y = Math.max(0, Math.min(graphHeight, event.clientY - rect.top));
  const pan = Math.max(-100, Math.min(100, Math.round((((1 - y / graphHeight) * 200) - 100) / 5) * 5));
  return { time: Math.max(0, Math.min(buffer.duration, ((event.clientX - rect.left) / rect.width) * buffer.duration)), pan };
}
function selectAutomationPoint(event) {
  const canvas = event.currentTarget, name = canvas.dataset.waveform, { time, pan } = automationCoordinates(event, canvas), buffer = tracks[name], automation = automationByTrack[name];
  const closeIndex = automation.points.findIndex(point => Math.abs(point.time - time) < Math.max(.25, buffer.duration * .015));
  if (closeIndex >= 0) automation.selected = closeIndex;
  else { automation.points.push({ time, pan }); automation.points.sort((a, b) => a.time - b.time); automation.selected = automation.points.findIndex(point => point.time === time); }
  refreshAutomation(name);
  markProjectDirty();
}
function moveAutomationPoint(event) {
  if (!automationDragging) return;
  const canvas = event.currentTarget, name = canvas.dataset.waveform, automation = automationByTrack[name], point = automation.points[automation.selected], { time, pan } = automationCoordinates(event, canvas), last = automation.points.length - 1;
  point.pan = pan;
  if (automation.selected > 0 && automation.selected < last) point.time = Math.max(automation.points[automation.selected - 1].time + .05, Math.min(automation.points[automation.selected + 1].time - .05, time));
  refreshAutomation(name);
  markProjectDirty();
}
function refreshAutomation(name) {
  // Refreshing the curve also reschedules live panning from the current play time.
  const automation = automationByTrack[name], point = automation.points[automation.selected];
  document.querySelectorAll(`[data-automation-pan="${name}"]`).forEach(button => button.classList.toggle('active', point && +button.dataset.pan === point.pan));
  const time = document.querySelector(`[data-automation-time="${name}"]`); if (time && point) time.textContent = formatTime(point.time);
  if (tracks[name]) drawWaveform(name, tracks[name]);
  updateLiveMix();
}
function bindAutomation() {
  document.querySelectorAll('[data-waveform]').forEach(canvas => { canvas.addEventListener('pointerdown', event => { selectAutomationPoint(event); automationDragging = true; canvas.setPointerCapture(event.pointerId); }); canvas.addEventListener('pointermove', moveAutomationPoint); canvas.addEventListener('pointerup', event => { automationDragging = false; canvas.releasePointerCapture(event.pointerId); }); });
  document.querySelectorAll('[data-automation-pan]').forEach(button => button.onclick = () => { const name = button.dataset.automationPan, automation = automationByTrack[name], point = automation.points[automation.selected]; if (!point) return; point.pan = +button.dataset.pan; refreshAutomation(name); markProjectDirty(); });
  document.querySelectorAll('[data-automation-remove]').forEach(remove => remove.onclick = () => { const name = remove.dataset.automationRemove, automation = automationByTrack[name]; if (automation.selected > 0 && automation.selected < automation.points.length - 1) { automation.points.splice(automation.selected, 1); automation.selected--; refreshAutomation(name); markProjectDirty(); } });
}
function bindFxButtons() {
  // Track buttons are generated after a separation, so bind them after every render.
  document.querySelectorAll('[data-fx]').forEach(button => button.onclick = () => fxModal?.open(button.dataset.fx));
}
function timelineDuration() {
  return Math.max(0, ...Object.values(tracks).map(buffer => buffer.duration));
}
function updatePlayheads(offset = playheadOffset) {
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
function seekMix(offset, restartPlayback = true) {
  const duration = timelineDuration();
  if (!duration) return;
  playheadOffset = Math.min(Math.max(0, duration - 0.02), Math.max(0, offset));
  updatePlayheads(playheadOffset);
  if (!restartPlayback || !playing || !audioCtx) return;

  // Recreate every source at the same offset so all stems stay aligned.
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
}
function seekFromPlayhead(event, playhead) {
  const rect = playhead.parentElement.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  seekMix(ratio * timelineDuration(), false);
}
function bindPlayheadSeeking() {
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
function startPlaybackSources(offset = playheadOffset) {
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
function createMasterLimiter(context) {
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.setValueAtTime(-1, context.currentTime);
  limiter.knee.setValueAtTime(0, context.currentTime);
  limiter.ratio.setValueAtTime(20, context.currentTime);
  limiter.attack.setValueAtTime(0.003, context.currentTime);
  limiter.release.setValueAtTime(0.16, context.currentTime);
  limiter.connect(context.destination);
  return limiter;
}
function effectTailSeconds() {
  let tail = 0;
  for (const name of Object.keys(tracks)) {
    const values = effectsByTrack[name] || effectDefaults;
    if (values.reverb > 0 && trackHasEffect('reverb', name)) tail = Math.max(tail, 1.7);
    if (values.delay > 0 && trackHasEffect('delay', name)) tail = Math.max(tail, 4.5);
  }
  return tail;
}
function animatePlayheads() {
  if (!playing || !audioCtx) { playheadFrame = undefined; updatePlayheads(); return; }
  if (paused) { playheadFrame = undefined; updatePlayheads(playheadOffset); return; }
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
}
function snapshotTrackControls(names) {
  return Object.fromEntries(names.map((name) => {
    const volume = document.querySelector(`[data-control="${name}"][data-param="volume"]`);
    const pan = document.querySelector(`[data-control="${name}"][data-param="pan"]`);
    const mute = document.querySelector(`[data-mute="${name}"]`);
    return [name, volume && pan && mute ? { volume: volume.value, pan: pan.value, muted: mute.getAttribute('aria-pressed') === 'true' } : {}];
  }));
}
function savePayload() {
  const names = Object.keys(tracks);
  return {
    settings: snapshotTrackControls(names),
    effects: Object.fromEntries(names.map(name => [name, effectsByTrack[name] || { ...effectDefaults }])),
    automation: Object.fromEntries(names.map(name => [name, automationByTrack[name] || { points: [], selected: 0 }])),
  };
}
async function apiJson(url, options = {}) {
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
function libraryLabels() {
  return getLanguage() === 'en' ? {
    title: 'My projects', description: 'Your folders and separations saved on this computer.', folder: 'Folder name', create: 'Create folder', importArchive: 'Import project', exportArchive: 'Export', imported: 'Project restored from archive.', empty: 'No folders yet. Create one to organize your projects.', noProjects: 'No projects in this folder yet.', open: 'Open', rename: 'Rename', remove: 'Delete', save: 'Save', update: 'Update project', saved: 'Project saved locally.', deleted: 'Deleted.', confirmFolder: 'Permanently delete this folder and all its projects? Type the exact folder name:', confirmProject: 'Permanently delete this project and its audio files? Type the exact project name:', select: 'Choose a folder', needFolder: 'Create or select a folder first.', currentTitle: 'Save current separation', hint: 'A project includes the separated tracks and all mixer settings.', name: 'Project name', noAudio: 'Separate a track before creating a project.'
  } : {
    title: 'Mes projets', description: 'Vos dossiers et séparations enregistrés sur cet ordinateur.', folder: 'Nom du nouveau dossier', create: 'Créer un dossier', importArchive: 'Importer un projet', exportArchive: 'Exporter', imported: 'Projet restauré depuis l’archive.', empty: 'Aucun dossier. Créez-en un pour organiser vos projets.', noProjects: 'Aucun projet dans ce dossier pour le moment.', open: 'Ouvrir', rename: 'Renommer', remove: 'Supprimer', save: 'Enregistrer', update: 'Mettre à jour', saved: 'Projet enregistré localement.', deleted: 'Élément supprimé.', confirmFolder: 'Supprimer définitivement ce dossier et tous ses projets ? Tapez le nom exact du dossier :', confirmProject: 'Supprimer définitivement ce projet et ses fichiers audio ? Tapez le nom exact du projet :', select: 'Choisir un dossier', needFolder: 'Créez ou choisissez d’abord un dossier.', name: 'Nom du projet', noAudio: 'Séparez un morceau avant de créer un projet.'
  };
}
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let libraryData = { folders: [] }, selectedFolderId = null;
async function refreshLibrary() {
  libraryData = await apiJson('/api/library');
  if (!libraryData.folders.some(folder => folder.id === selectedFolderId)) selectedFolderId = libraryData.folders[0]?.id || null;
  renderLibrary();
}
function renderLibrary() {
  const labels = libraryLabels(), workspace = $('#libraryWorkspace'), select = $('#saveFolderSelect');
  const warnings = libraryData.warnings || [];
  const warningHtml = warnings.length ? `<p class="library-warning" role="alert">${getLanguage() === 'en' ? `${warnings.length} local item${warnings.length === 1 ? '' : 's'} could not be read. A manifest backup was checked when available.` : `${warnings.length} élément${warnings.length === 1 ? '' : 's'} local${warnings.length === 1 ? '' : 'aux'} n’a pu être lu. Une sauvegarde de manifeste a été essayée lorsqu’elle était disponible.`}</p>` : '';
  $('#libraryTitle').textContent = labels.title;
  $('#libraryDescription').textContent = labels.description;
  const closeButton = $('#libraryModal')?.querySelector('.changelog-close');
  if (closeButton) { const closeLabel = getLanguage() === 'en' ? 'Close' : 'Fermer'; closeButton.title = closeLabel; closeButton.setAttribute('aria-label', closeLabel); }
  $('#newFolderName').placeholder = labels.folder;
  $('#createFolderButton').textContent = labels.create;
  $('#importProjectButton').textContent = labels.importArchive;
  $('#saveProjectHeading').textContent = labels.currentTitle;
  $('#saveProjectHint').textContent = labels.hint || (getLanguage() === 'en' ? 'A project includes separated tracks and all mixer settings.' : 'Un projet contient les pistes séparées et tous les réglages du mixeur.');
  $('#projectNameInput').placeholder = labels.name;
  $('#saveProjectButton').textContent = activeProjectId ? labels.update : labels.save;
  $('#saveProjectPanel').classList.toggle('hidden', !Object.keys(tracks).length || (!currentJobId && !activeProjectId));
  select.innerHTML = libraryData.folders.length ? libraryData.folders.map(folder => `<option value="${folder.id}" ${folder.id === selectedFolderId ? 'selected' : ''}>${escapeHtml(folder.name)}</option>`).join('') : `<option value="">${labels.select}</option>`;
  const current = libraryData.folders.find(folder => folder.id === selectedFolderId);
  if (!current) { workspace.innerHTML = `${warningHtml}<p class="library-empty">${labels.empty}</p>`; return; }
  workspace.innerHTML = `${warningHtml}<nav class="library-folders">${libraryData.folders.map(folder => `<button type="button" data-folder="${folder.id}" class="library-folder ${folder.id === current.id ? 'active' : ''}"><span>${escapeHtml(folder.name)}</span><small>${folder.projects.length}</small></button>`).join('')}</nav><section class="library-projects"><div class="library-folder-heading"><h3>${escapeHtml(current.name)}</h3><div><button type="button" data-rename-folder="${current.id}">${labels.rename}</button><button type="button" data-delete-folder="${current.id}">${labels.remove}</button></div></div>${current.projects.length ? current.projects.map(project => `<article class="library-project"><div><h4>${escapeHtml(project.name)}</h4><p>${escapeHtml(project.sourceName || '')} · ${new Date(project.updatedAt).toLocaleDateString(getLanguage() === 'en' ? 'en-US' : 'fr-FR')}</p></div><div><button type="button" data-open-project="${project.id}">${labels.open}</button><button type="button" data-export-project="${project.id}">${labels.exportArchive}</button><button type="button" data-rename-project="${project.id}">${labels.rename}</button><button type="button" data-delete-project="${project.id}">${labels.remove}</button></div></article>`).join('') : `<p class="library-empty">${labels.noProjects}</p>`}</section>`;
  workspace.querySelectorAll('[data-folder]').forEach(button => button.onclick = () => { selectedFolderId = button.dataset.folder; renderLibrary(); });
  workspace.querySelectorAll('[data-rename-folder]').forEach(button => button.onclick = () => void renameLibraryItem(`/api/library/folders/${button.dataset.renameFolder}`, current.name));
  workspace.querySelectorAll('[data-delete-folder]').forEach(button => button.onclick = async () => {
    const confirmation = window.prompt(labels.confirmFolder);
    if (confirmation !== current.name) return;
    try {
      await apiJson(`/api/library/folders/${button.dataset.deleteFolder}`, { method: 'DELETE', body: JSON.stringify({ confirmation }) });
      if (activeProjectId && current.projects.some(project => project.id === activeProjectId)) { activeProjectId = null; currentJobId = null; }
      selectedFolderId = null;
      await refreshLibrary();
    } catch (error) { status(error.message, true); }
  });
  workspace.querySelectorAll('[data-open-project]').forEach(button => button.onclick = () => void openSavedProject(button.dataset.openProject));
  workspace.querySelectorAll('[data-export-project]').forEach(button => button.onclick = () => { window.location.href = `/api/library/projects/${button.dataset.exportProject}/archive`; });
  workspace.querySelectorAll('[data-rename-project]').forEach(button => button.onclick = () => { const project = current.projects.find(item => item.id === button.dataset.renameProject); void renameLibraryItem(`/api/library/projects/${project.id}`, project.name); });
  workspace.querySelectorAll('[data-delete-project]').forEach(button => button.onclick = async () => {
    const project = current.projects.find(item => item.id === button.dataset.deleteProject);
    if (!project) return;
    const confirmation = window.prompt(labels.confirmProject);
    if (confirmation !== project.name) return;
    try {
      await apiJson(`/api/library/projects/${project.id}`, { method: 'DELETE', body: JSON.stringify({ confirmation }) });
      if (activeProjectId === project.id) { activeProjectId = null; currentJobId = null; projectDirty = false; }
      await refreshLibrary();
    } catch (error) { status(error.message, true); }
  });
}
async function renameLibraryItem(url, oldName) {
  const value = prompt(getLanguage() === 'en' ? 'New name:' : 'Nouveau nom :', oldName);
  if (!value?.trim()) return;
  try { await apiJson(url, { method: 'PATCH', body: JSON.stringify({ name: value.trim() }) }); await refreshLibrary(); }
  catch (error) { status(error.message, true); }
}
async function confirmCurrentMixReplacement() {
  if (activeProjectId) {
    if (!projectDirty) return true;
    if (projectSaving) {
      status(getLanguage() === 'en' ? 'The current project is still saving. Try again in a moment.' : 'Le projet actuel est encore en cours de sauvegarde. Réessayez dans un instant.', true);
      return false;
    }
    return saveCurrentProject({ automatic: true });
  }
  if (currentJobId) {
    return window.confirm(getLanguage() === 'en'
      ? 'The current separation has not been saved as a project. Replace it and its mix settings?'
      : 'La séparation actuelle n’est pas enregistrée comme projet. La remplacer ainsi que ses réglages de mixage ?');
  }
  return true;
}
async function openSavedProject(projectId) {
  try {
    if (!(await confirmCurrentMixReplacement())) return;
    const project = await apiJson(`/api/library/projects/${projectId}`);
    const decodedStemBytes = Object.values(project.stemDecodedBytes || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    const largestDownloadBytes = Math.max(0, ...Object.values(project.stemFileBytes || {}).map(value => Number(value || 0)));
    if (decodedStemBytes + largestDownloadBytes > MAX_DECODED_STEM_BYTES) throw new Error(t('status.decodeMemoryLimit'));
    if (!audioCtx || audioCtx.state === 'closed') audioCtx = new AudioContext();
    clearMixerForReplacement();
    status(getLanguage() === 'en' ? 'Loading project audio…' : 'Chargement de l’audio du projet…');
    const decoded = [];
    for (const name of project.stems) {
      const response = await fetch(project.audio[name]);
      if (!response.ok) throw new Error(`${name}: ${response.statusText}`);
      const bytes = await response.arrayBuffer();
      decoded.push([name, await audioCtx.decodeAudioData(bytes)]);
    }
    decoded.forEach(([name, buffer]) => { tracks[name] = buffer; effectsByTrack[name] = { ...effectDefaults, ...(project.effects?.[name] || {}) }; automationByTrack[name] = project.automation?.[name] || { points: [{ time: 0, pan: 0 }, { time: buffer.duration, pan: 0 }], selected: 0 }; });
    currentSourceName = project.sourceName || project.name;
    currentMode = project.mode || 'simple'; currentEngine = project.engine || 'fast';
    document.querySelector(`input[name="splitMode"][value="${currentMode}"]`).checked = true;
    document.querySelector(`input[name="engine"][value="${currentEngine}"]`).checked = true;
    currentJobId = null; activeProjectId = project.id; projectDirty = false;
    $('#fileName').textContent = currentSourceName;
    $('#projectNameInput').value = project.name;
    renderTracks(project.stems, project.settings || {});
    $('#mixer').classList.remove('hidden'); $('#exportButton').disabled = false;
    setTransportState();
    autosaveNotice('ready');
    requestAnimationFrame(() => { decoded.forEach(([name, buffer]) => drawWaveform(name, buffer)); project.stems.forEach(refreshAutomation); });
    libraryModal.close(); status(getLanguage() === 'en' ? 'Project loaded from local storage.' : 'Projet chargé depuis le stockage local.');
  } catch (error) { console.error('Could not load local project.', error); status(error.message, true); }
}
async function saveCurrentProject({ automatic = false } = {}) {
  const labels = libraryLabels(), name = $('#projectNameInput').value.trim() || currentSourceName.replace(/\.[^.]+$/, '') || 'AudioSplit project';
  if (projectSaving || !Object.keys(tracks).length) return false;
  projectSaving = true;
  const savedRevision = projectRevision;
  const payload = savePayload();
  if (activeProjectId) autosaveNotice('saving');
  try {
    let result;
    if (activeProjectId) result = await apiJson(`/api/library/projects/${activeProjectId}`, { method: 'PUT', body: JSON.stringify({ name, ...payload }) });
    else {
      const folderId = $('#saveFolderSelect').value;
      if (!folderId) throw new Error(labels.needFolder);
      if (!currentJobId) throw new Error(labels.noAudio);
      result = await apiJson(`/api/library/folders/${folderId}/projects`, { method: 'POST', body: JSON.stringify({ jobId: currentJobId, name, sourceName: currentSourceName, mode: currentMode, engine: currentEngine, ...payload }) });
      activeProjectId = result.id;
    }
    $('#projectNameInput').value = result.name || name;
    if (projectRevision === savedRevision) projectDirty = false;
    await refreshLibrary();
    status(labels.saved);
    if (projectDirty) autosaveNotice('dirty'); else autosaveNotice('saved', clockTime());
    return true;
  } catch (error) {
    status(error.message, true);
    autosaveNotice(automatic ? 'error' : 'manualError', error.message);
    return false;
  } finally { projectSaving = false; }
}
function renderTracks(names, savedControls = {}) {
  // Detailed splits expose a bass stem; simple splits use accompaniment as the bass source.
  saturationTarget = names.includes('bass') ? 'bass' : 'accompaniment';
  widthTarget = names.includes('other') ? 'other' : 'accompaniment';
  names.forEach(name => { effectsByTrack[name] ??= { ...effectDefaults }; });
  $('#tracks').innerHTML = names.map((name) => {
    const info = stemInfo[name], trackTitle = t(info.titleKey), trackDetail = t(info.detailKey), saved = savedControls[name] || {};
    const volume = saved.volume ?? 100, pan = saved.pan ?? 0, muted = saved.muted ?? false;
    const automation = `<div class="automation-tools"><span>${t('automation.pan', { track: trackTitle.toLowerCase() })}</span><span class="automation-time" data-automation-time="${name}">0:00</span><button type="button" data-automation-pan="${name}" data-pan="-100">${t('automation.left')}</button><button type="button" data-automation-pan="${name}" data-pan="0">${t('automation.center')}</button><button type="button" data-automation-pan="${name}" data-pan="100">${t('automation.right')}</button><button type="button" class="remove-point" data-automation-remove="${name}" title="${t('automation.remove')}">×</button></div>`;
    return `<article class="track ${name}"><div class="track-icon">${icon(info.icon)}</div><div class="track-title"><h3>${trackTitle}</h3><p>${trackDetail}</p></div><button type="button" class="fx-button" data-fx="${name}" title="${t('fx.open', { track: trackTitle })}">Fx</button><div class="pan-fader" title="${t('control.panTitle')}"><span class="pan-letter">L</span><div class="gauge pan-gauge"><i></i><input aria-label="${t('control.pan', { track: trackTitle })}" data-control="${name}" data-param="pan" type="range" min="-100" max="100" value="${pan}"></div><output id="${name}PanOut">${pan}</output><span class="pan-letter">R</span></div><div class="wave-area"><canvas class="waveform" data-waveform="${name}" aria-label="${trackTitle}"></canvas><span class="playhead" data-playhead="${name}" role="slider" tabindex="0" aria-label="${t('playhead.label', { track: trackTitle })}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="0:00"></span>${automation}</div><div class="volume-stack"><button class="mute" data-mute="${name}" aria-pressed="${muted}" title="${t('control.mute', { track: trackTitle })}">${speakerIcon(muted)}</button><div class="volume-fader" title="${t('control.volumeTitle')}"><div class="gauge volume-gauge"><i></i><input aria-label="${t('control.volume', { track: trackTitle })}" data-control="${name}" data-param="volume" type="range" min="0" max="150" value="${volume}"></div><output id="${name}VolumeOut">${volume}</output></div></div></article>`;
  }).join('');
  document.querySelectorAll('[data-control]').forEach(el => el.oninput = () => { updateOutputs(); markProjectDirty(); });
  document.querySelectorAll('[data-mute]').forEach(button => button.onclick = () => { const muted = button.getAttribute('aria-pressed') === 'true'; button.setAttribute('aria-pressed', String(!muted)); button.innerHTML = speakerIcon(!muted); updateLiveMix(); markProjectDirty(); });
  bindAutomation();
  bindPlayheadSeeking();
  bindFxButtons();
  updateOutputs();
}
function clearMixerForReplacement() {
  // Release decoded buffers before loading a replacement so both mixes are
  // never resident in memory at the same time.
  stop();
  Object.keys(tracks).forEach(name => delete tracks[name]);
  Object.keys(effectsByTrack).forEach(name => delete effectsByTrack[name]);
  Object.keys(automationByTrack).forEach(name => delete automationByTrack[name]);
  currentJobId = null;
  activeProjectId = null;
  projectDirty = false;
  $('#mixer').classList.add('hidden');
  $('#tracks').replaceChildren();
  $('#exportButton').disabled = true;
}
// Stop all live nodes together because every stem starts at the same audio clock time.
function stop() {
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
async function playMix() {
  if (playing && audioCtx) {
    try {
      if (paused) {
        await audioCtx.resume();
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
      status(t('status.playbackChange', { error: error.message }), true);
    }
    return;
  }

  if (!Object.keys(tracks).length) return;
  const startOffset = playheadOffset;
  stop();
  playheadOffset = startOffset;
  if (!audioCtx || audioCtx.state === 'closed') audioCtx = new AudioContext();
  try {
    // A context created after a long Demucs task is commonly suspended by Chrome.
    await audioCtx.resume();
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
    status(t('status.playbackStart', { error: error.message }), true);
  }
}
function encodeWavInWorker(buffer) {
  const worker = new Worker(new URL('./js/wav-encoder-worker.js?v=1.3.3', import.meta.url), { type: 'module' });
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => new Float32Array(buffer.getChannelData(channel)));
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error)); else resolve(data);
    };
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || 'WAV encoding worker failed.')); };
    worker.postMessage({ channels, sampleRate: buffer.sampleRate }, channels.map(channel => channel.buffer));
  });
}
async function exportMix() {
  // OfflineAudioContext renders the current mix without recording speaker output.
  if (!Object.keys(tracks).length) return;
  const button = $('#exportButton');
  if (button.disabled) return;
  button.disabled = true;
  try {
    stop(); const duration = Math.max(...Object.values(tracks).map(b => b.duration)), rate = tracks.vocals.sampleRate;
    const renderDuration = duration + effectTailSeconds(), renderLength = Math.ceil(renderDuration * rate);
    const decodedBytes = Object.values(tracks).reduce((total, buffer) => total + buffer.length * buffer.numberOfChannels * 4, 0);
    const renderBytes = renderLength * 2 * 4, wavBytes = renderLength * 2 * 2 + 44;
    const workingBytes = decodedBytes + renderBytes * 2 + wavBytes * 2;
    if (workingBytes > MAX_EXPORT_WORKING_BYTES) throw new Error(t('status.exportMemoryLimit'));
    if (wavBytes - 44 + 36 > WAV_RIFF_MAX_BYTES) throw new Error('WAV export exceeds the 4 GiB RIFF limit.');
    const offline = new OfflineAudioContext(2, renderLength, rate), master = createMasterLimiter(offline);
    const offlineNodes = new Map();
    for (const [name, buffer] of Object.entries(tracks)) { const source=offline.createBufferSource(),cfg=settings(name),nodes=createTrackNodes(offline,source,name,cfg,master); source.buffer=buffer;schedulePan(nodes.panner,name,cfg,0,0,buffer.duration);source.start();offlineNodes.set(name,nodes); }
    // Offline rendering has no animation frame, so schedule the vocal envelope in advance.
    if (tracks.vocals) for (const [name, nodes] of offlineNodes) if (nodes.effects.ducking) scheduleOfflineVoiceDucking(nodes.effects.ducking, tracks.vocals, settings(name).effects.ducking, offline);
    for (const [name, nodes] of offlineNodes) if (nodes.effects.deEsser) scheduleOfflineDeEsser(nodes.effects.deEsser, tracks[name], settings(name).effects.deEsser);
    for (const [name, nodes] of offlineNodes) if (nodes.effects.gate) scheduleOfflineNoiseGate(nodes.effects.gate, tracks[name], settings(name).effects.gate, offline);
    status(t('status.rendering')); const rendered=await offline.startRendering(), result=await encodeWavInWorker(rendered), url=URL.createObjectURL(result.blob), link=document.createElement('a');link.href=url;link.download='audiosplit-mix-stereo.wav';link.click();setTimeout(() => URL.revokeObjectURL(url), 1000);status(result.normalized ? t('status.exportedNormalized') : t('status.exported'));
  } catch (error) {
    console.error('Audio export failed.', error);
    status(t('status.exportError', { error: error.message || error }), true);
  } finally {
    button.disabled = !Object.keys(tracks).length;
  }
}
$('#chooseButton').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = (event) => {
  const file = event.target.files[0];
  $('#fileName').textContent = file ? file.name : '';
  $('#separateButton').disabled = !file;
  status('');
};

async function separateAudio() {
  const file = $('#fileInput').files[0];
  if (!file) return;
  const button = $('#separateButton');
  if (button.disabled) return;
  button.disabled = true;
  if (!(await confirmCurrentMixReplacement())) {
    button.disabled = !$('#fileInput').files[0];
    return;
  }
  const cacheButton = $('#clearCacheButton');
  const cancelButton = $('#cancelSeparationButton');
  const mode = document.querySelector('input[name="splitMode"]:checked').value;
  const engine = document.querySelector('input[name="engine"]:checked').value;
  cacheButton.disabled = true;
  separationCancelRequested = false;
  activeSeparationRequestId = window.crypto?.randomUUID
    ? window.crypto.randomUUID().replaceAll('-', '')
    : Array.from(window.crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
  const requestId = activeSeparationRequestId;
  cancelButton.disabled = false;
  cancelButton.classList.remove('hidden');
  startSeparationProgressPolling(requestId);
  status(engine === 'fast' ? t('status.fast') : t('status.studio'));
  const form = new FormData();
  form.append('file', file);
  form.append('mode', mode);
  form.append('engine', engine);
  form.append('language', getLanguage());
  form.append('request_id', requestId);

  try {
    const data = await apiJson('/api/separate', { method: 'POST', body: form });
    const estimatedDecodedBytes = data.duration * 44_100 * 2 * 4 * Object.keys(data.stems).length;
    const estimatedPeakDecodeBytes = estimatedDecodedBytes * (1 + 0.5 / Object.keys(data.stems).length);
    if (estimatedPeakDecodeBytes > MAX_DECODED_STEM_BYTES) throw new Error(t('status.decodeMemoryLimit'));

    // Decoding completes before the mixer is rendered, preventing a half-ready UI.
    if (!audioCtx || audioCtx.state === 'closed') audioCtx = new AudioContext();
    clearMixerForReplacement();
    status(getLanguage() === 'en' ? 'Loading separated tracks…' : 'Chargement des pistes séparées…');
    const names = Object.keys(data.stems);
    const decoded = [];
    for (const name of names) {
      const stemResponse = await fetch(`${data.stems[name]}?lang=${getLanguage()}`);
      if (!stemResponse.ok) throw Error(t('status.trackMissing', { track: t(stemInfo[name].titleKey) }));
      const bytes = await stemResponse.arrayBuffer();
      decoded.push([name, await audioCtx.decodeAudioData(bytes)]);
    }

    currentJobId = data.jobId;
    currentSourceName = file.name;
    currentMode = mode;
    currentEngine = engine;
    activeProjectId = null;
    projectDirty = false;
    if ($('#projectNameInput')) $('#projectNameInput').value = file.name.replace(/\.[^.]+$/, '');
    decoded.forEach(([name, buffer]) => {
      tracks[name] = buffer;
      ensureAutomation(name, buffer.duration);
    });
    renderTracks(names);
    setTransportState();
    $('#mixer').classList.remove('hidden');
    requestAnimationFrame(() => {
      decoded.forEach(([name, buffer]) => drawWaveform(name, buffer));
      names.forEach(refreshAutomation);
    });
    $('#exportButton').disabled = false;
    autosaveNotice('waiting');
    status(data.cacheHit ? t('status.cached') : t('status.finished'));
  } catch (error) {
    console.error('Audio separation failed.', error);
    status(separationCancelRequested ? t('status.cancelled') : error.message, !separationCancelRequested);
  } finally {
    stopSeparationProgressPolling();
    activeSeparationRequestId = null;
    cancelButton.disabled = true;
    cancelButton.classList.add('hidden');
    button.disabled = !$('#fileInput').files[0];
    cacheButton.disabled = false;
  }
}

$('#cancelSeparationButton').onclick = async () => {
  const button = $('#cancelSeparationButton'), requestId = activeSeparationRequestId;
  if (!requestId || button.disabled) return;
  button.disabled = true;
  try {
    await apiJson(`/api/separations/${requestId}/cancel`, { method: 'POST' });
    separationCancelRequested = true;
    status(t('status.canceling'));
  } catch (error) {
    button.disabled = false;
    status(error.message, true);
  }
};

async function clearAudioSplitCache() {
  const button = $('#clearCacheButton');
  button.disabled = true;
  try {
    const data = await apiJson(`/api/cache?lang=${getLanguage()}`, { method: 'DELETE' });
    const total = data.removedJobs + data.removedUploads;
    status(t('status.cacheCleared', { count: total, plural: total > 1 ? 's' : '' }));
  } catch (error) {
    console.error('AudioSplit cache could not be cleared.', error);
    status(error.message, true);
  } finally {
    button.disabled = false;
  }
}

$('#separateButton').onclick = () => { void separateAudio(); };
$('#clearCacheButton').onclick = () => {
  if (window.confirm(t('cache.confirm'))) void clearAudioSplitCache();
};
$('#playButton').onclick = () => { void playMix(); };
$('#stopButton').onclick = stop;
$('#exportButton').onclick = exportMix;
applyTranslations();
setTransportState();
// Modal HTML is loaded separately so individual dialogs can evolve independently.
async function initializeModalComponents() {
  try {
    await mountModalComponents($('#modalRoot'));
    applyTranslations();
    fxModal = createFxModal({
      stemInfo,
    getSaturationTarget: () => saturationTarget,
      getWidthTarget: () => widthTarget,
      getValues: (name) => effectsByTrack[name] || { ...effectDefaults },
      setValue: (name, key, value) => { effectsByTrack[name][key] = value; updateLiveMix(); markProjectDirty(); },
    });
    changelogModal = createChangelogModal($('#versionButton'));
    languageModal = createLanguageModal($('#languageButton'));
    const libraryElement = $('#libraryModal'), libraryTrigger = $('#libraryButton');
    bindModalAccessibility(libraryElement);
    const closeLibrary = () => { libraryElement.classList.remove('is-open'); setTimeout(() => { libraryElement.setAttribute('aria-hidden', 'true'); libraryTrigger.focus(); }, 240); };
    libraryElement.querySelectorAll('[data-library-close]').forEach(button => button.onclick = closeLibrary);
    libraryTrigger.onclick = async () => {
      try { await refreshLibrary(); } catch (error) { status(error.message, true); }
      libraryElement.setAttribute('aria-hidden', 'false'); requestAnimationFrame(() => libraryElement.classList.add('is-open'));
      libraryElement.querySelector('.changelog-close').focus();
    };
    libraryModal = { close: closeLibrary };
    $('#libraryButton').textContent = getLanguage() === 'en' ? 'Projects' : 'Projets';
    $('#projectNameInput').value = currentSourceName.replace(/\.[^.]+$/, '');
    $('#projectNameInput').oninput = markProjectDirty;
    $('#createFolderButton').onclick = async () => {
      const input = $('#newFolderName'), name = input.value.trim();
      if (!name) { input.focus(); return; }
      try { const folder = await apiJson('/api/library/folders', { method: 'POST', body: JSON.stringify({ name }) }); selectedFolderId = folder.id; input.value = ''; await refreshLibrary(); }
      catch (error) { status(error.message, true); }
    };
    $('#importProjectButton').onclick = () => $('#projectArchiveInput').click();
    $('#projectArchiveInput').onchange = async event => {
      const file = event.target.files[0], folderId = selectedFolderId || $('#saveFolderSelect').value;
      if (!file) return;
      if (!folderId) { status(libraryLabels().needFolder, true); event.target.value = ''; return; }
      const form = new FormData();
      form.append('file', file);
      $('#importProjectButton').disabled = true;
      try {
        await apiJson(`/api/library/folders/${folderId}/projects/import`, { method: 'POST', body: form });
        selectedFolderId = folderId;
        await refreshLibrary();
        status(libraryLabels().imported);
      } catch (error) {
        status(error.message, true);
      } finally {
        $('#importProjectButton').disabled = false;
        event.target.value = '';
      }
    };
    $('#saveProjectButton').onclick = () => void saveCurrentProject();
    $('#saveFolderSelect').onchange = event => { selectedFolderId = event.target.value || null; };
    bindFxButtons();
  } catch (error) {
    // A missing component should not block audio separation or mixing.
    console.error('Modal components could not be loaded.', error);
    $('#versionButton').disabled = true;
  }
}
onLanguageChange(() => {
  $('#libraryButton').textContent = getLanguage() === 'en' ? 'Projects' : 'Projets';
  if (activeProjectId) autosaveNotice(projectDirty ? 'dirty' : 'ready');
  else if (currentJobId) autosaveNotice('waiting');
  if ($('#libraryModal')) renderLibrary();
  const names = Object.keys(tracks);
  if (names.length) {
    const savedControls = snapshotTrackControls(names);
    fxModal?.close();
    renderTracks(names, savedControls);
    requestAnimationFrame(() => {
      names.forEach((name) => { if (tracks[name]) drawWaveform(name, tracks[name]); });
      names.forEach(refreshAutomation);
      updatePlayheads(Math.max(0, audioCtx ? audioCtx.currentTime - playStartedAt : 0));
    });
  }
  setTransportState(playing ? (paused ? 'paused' : 'playing') : 'stopped');
});
initializeModalComponents();
setInterval(() => {
  if (activeProjectId && projectDirty && !projectSaving) void saveCurrentProject({ automatic: true });
}, 10000);
window.addEventListener('beforeunload', (event) => {
  if ((activeProjectId && projectDirty) || (currentJobId && !activeProjectId)) {
    event.preventDefault();
    event.returnValue = '';
  }
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') { fxModal?.close(); changelogModal?.close(); languageModal?.close(); libraryModal?.close(); } });
window.addEventListener('resize',()=>Object.entries(tracks).forEach(([name, buffer])=>buffer&&drawWaveform(name,buffer)));
