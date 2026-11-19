import { createBassSaturation, updateBassSaturation } from './effects/bass-saturation.js?v=1.5.0.18';
import { createBassBoost, updateBassBoost } from './effects/bass-boost.js?v=1.5.0.18';
import { createCompressor, updateCompressor } from './effects/compressor.js?v=1.5.0.18';
import { createThreeBandEq, updateThreeBandEq } from './effects/three-band-eq.js?v=1.5.0.18';
import { createReverb, updateReverb } from './effects/reverb.js?v=1.5.0.18';
import { createDelay, updateDelay } from './effects/delay.js?v=1.5.0.18';
import { createFilters, updateFilters } from './effects/filters.js?v=1.5.0.18';
import { createStereoWidth, updateStereoWidth } from './effects/stereo-width.js?v=1.5.0.18';
import { createChorus, updateChorus } from './effects/chorus.js?v=1.5.0.18';
import { createFlanger, updateFlanger } from './effects/flanger.js?v=1.5.0.18';
import { createPhaser, updatePhaser } from './effects/phaser.js?v=1.5.0.18';
import { createTremolo, updateTremolo } from './effects/tremolo.js?v=1.5.0.18';
import { createBitcrusher, updateBitcrusher } from './effects/bitcrusher.js?v=1.5.0.18';
import { createNoiseGate, scheduleOfflineNoiseGate, updateNoiseGate } from './effects/noise-gate.js?v=1.5.0.18';
import { createDeEsser, scheduleOfflineDeEsser, updateDeEsser } from './effects/de-esser.js?v=1.5.0.18';
import { createLimiter, updateLimiter } from './effects/limiter.js?v=1.5.0.18';
import { createExciter, updateExciter } from './effects/exciter.js?v=1.5.0.18';
import { effectCatalog, effectIsAvailable } from './effects/catalog.js?v=1.5.0.18';
import { createVoiceDucker, createVoiceMeter, readVoiceLevel, scheduleOfflineVoiceDucking, updateVoiceDucking } from './effects/voice-ducking.js?v=1.5.0.18';
import { getLanguage, onLanguageChange, t } from './i18n.js?v=1.5.0.38';
import { lucideIcon } from './lucide.js?v=1.5.0.18';
import { generateCurveTemplatePoints } from './pan-curves.js?v=1.5.0.38';

// Small DOM helper kept in the entry module so the UI code stays readable.
export const $ = (sel) => document.querySelector(sel);
export const tracks = {};
export const automationByTrack = {};
export const effectDefaults = { saturation: 0, bassBoost: 0, compressor: 0, eqLow: 0, eqMid: 0, eqHigh: 0, reverb: 0, delay: 0, highPass: 0, lowPass: 0, width: 100, ducking: 0, chorus: 0, flanger: 0, phaser: 0, tremolo: 0, bitcrusher: 0, gate: 0, deEsser: 0, limiter: 0, exciter: 0 };
export const MAX_DECODED_STEM_BYTES = 1024 * 1024 * 1024;
export const MAX_EXPORT_WORKING_BYTES = 2 * 1024 * 1024 * 1024;
export const WAV_RIFF_MAX_BYTES = 0xffffffff;
export const effectsByTrack = {};
// Keep polling state inside this ES module; app.js has its own request state.
let activeSeparationRequestId = null;
let separationPollTimer = null;
let separationPollBusy = false;
export function setTrackTargets(hasBass, hasOther) { saturationTarget = hasBass ? 'bass' : 'accompaniment'; widthTarget = hasOther ? 'other' : 'accompaniment'; }
export function getSaturationTarget() { return saturationTarget; }
export function getWidthTarget() { return widthTarget; }
export let audioCtx, liveNodes = new Map(), liveMaster, playing = false, paused = false, playStartedAt = 0, playheadOffset = 0, playheadDragging = false, playheadWasPlaying = false, automationDragging = false, playheadFrame, playbackEndTimer, playbackToken = 0, saturationTarget = 'accompaniment', widthTarget = 'accompaniment', voiceMeter;

export function autosaveNotice(state, detail = '') {
  const english = getLanguage() === 'en';
  const messages = {
    ready: english ? 'Autosave active · every 10 seconds' : 'Sauvegarde auto active · toutes les 10 s',
    waiting: english ? 'Save this project once to enable autosave.' : 'Enregistre le projet une fois pour activer la sauvegarde auto.',
    dirty: english ? 'Changes pending · autosave in 10 seconds' : 'Modifications en attente · sauvegarde auto sous 10 s',
    saving: english ? 'Saving project…' : 'Sauvegarde du projet…',
    saved: english ? `Project saved at ${detail}` : `Projet sauvegardé à ${detail}`,
    error: english ? 'Autosave failed. Your changes are still pending; try Save again.' : 'Échec de la sauvegarde auto. Vos changements restent en attente ; réessayez d’enregistrer.',
    manualError: english ? 'Could not save the project. Your changes are still pending; try again.' : 'Impossible d’enregistrer le projet. Vos changements restent en attente ; réessayez.',
  };
  const message = messages[state] || detail;
  if (state === 'ready') return updateTaskNotice('autosave', '');
  const completed = state === 'saved';
  updateTaskNotice('autosave', message, {
    state: state === 'saving' ? 'saving' : state === 'dirty' ? 'dirty' : state === 'waiting' ? 'waiting' : completed ? 'complete' : 'error',
    duration: completed ? 4500 : ['error', 'manualError'].includes(state) ? 7000 : 0,
  });
}
export function markProjectDirty() { window.dispatchEvent(new Event('audiosplit:project-dirty')); }
export function clockTime() { return new Intl.DateTimeFormat(getLanguage() === 'en' ? 'en-US' : 'fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date()); }

const islandTasks = new Map();
const islandTaskTimers = new Map();
let islandExpanded = false;
let playbackLabel = '';
let playbackIslandTimer = null;
const islandStateLabel = state => {
  const english = getLanguage() === 'en';
  return ({
    progress: english ? 'In progress' : 'En cours',
    saving: english ? 'Saving' : 'En cours',
    dirty: english ? 'Pending' : 'En attente',
    waiting: english ? 'Waiting' : 'En attente',
    complete: english ? 'Complete' : 'Terminé',
    error: english ? 'Failed' : 'Échec',
    playing: english ? 'Playing' : 'Lecture',
    paused: english ? 'Paused' : 'En pause',
  })[state] || (english ? 'Notice' : 'Info');
};
function renderTaskIsland() {
  const island = $('#status'), message = $('#statusText'), more = $('#statusMoreButton');
  if (!island || !message || !more) return;
  const tasks = [...islandTasks.values()].sort((a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt);
  const primary = tasks[0];
  const secondary = tasks[1];
  const english = getLanguage() === 'en';
  message.textContent = primary?.message || '';
  island.setAttribute('aria-label', primary?.message || (english ? 'AudioSplit Studio is ready' : 'AudioSplit Studio est prêt'));
  island.classList.toggle('is-idle', !primary);
  island.classList.toggle('is-active', Boolean(primary));
  island.classList.toggle('is-expanded', islandExpanded && tasks.length > 1);
  island.classList.toggle('is-progress', primary?.state === 'progress' || primary?.state === 'dirty');
  island.classList.toggle('is-saving', primary?.state === 'saving');
  island.classList.toggle('is-error', primary?.state === 'error');
  island.classList.toggle('is-complete', primary?.state === 'complete');
  island.classList.toggle('is-playing', primary?.state === 'playing');
  island.classList.toggle('is-paused', primary?.state === 'paused');
  island.classList.toggle('has-secondary-task', Boolean(secondary));
  island.title = primary?.message || (english ? 'AudioSplit Studio is ready' : 'AudioSplit Studio est prêt');
  const progressBar = $('#statusProgressBar');
  if (progressBar) {
    const match = primary?.message.match(/(\d+(?:[.,]\d+)?)\s*%/);
    const messageProgress = match ? Number(match[1].replace(',', '.')) : null;
    const progress = Number.isFinite(primary?.progress) ? primary.progress : messageProgress;
    progressBar.style.width = progress === null ? '14%' : `${Math.max(0, Math.min(100, progress))}%`;
    island.classList.toggle('is-indeterminate', Boolean(primary?.state === 'progress' && progress === null));
  }

  more.hidden = !secondary;
  more.dataset.taskState = secondary?.state || '';
  const glyphs = {
    progress: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    saving: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    dirty: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    waiting: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    playing: '<path d="M4 10v4m4-8v12m4-15v18m4-14v10m4-7v4"/>',
    paused: '<path d="M8 5v14M16 5v14"/>',
    complete: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
    error: '<path d="M10.3 3.9 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/>',
  };
  $('#statusSecondaryGlyph').innerHTML = `<svg viewBox="0 0 24 24">${glyphs[secondary?.state] || '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>'}</svg>`;
  const extraCount = Math.max(0, tasks.length - 2);
  $('#statusTaskCount').hidden = extraCount === 0;
  $('#statusTaskCount').textContent = extraCount > 9 ? '9+' : `+${extraCount}`;
  more.title = secondary?.message || '';
  more.setAttribute('aria-label', secondary
    ? (english ? `Next: ${secondary.message}${extraCount ? `. ${extraCount} more tasks` : ''}. Show activity` : `Ensuite : ${secondary.message}${extraCount ? `. ${extraCount} autre${extraCount > 1 ? 's' : ''} tâche${extraCount > 1 ? 's' : ''}` : ''}. Afficher l’activité`)
    : (english ? 'Show studio activity' : 'Afficher l’activité du studio'));
  more.setAttribute('aria-expanded', String(islandExpanded && tasks.length > 1));
  const details = $('#statusDetails'), list = $('#statusTaskList'), title = $('#statusDetailsTitle');
  if (details && list && title) {
    title.textContent = english ? 'Studio activity' : 'Activité du studio';
    details.setAttribute('aria-label', title.textContent);
    const detailsOpen = islandExpanded && tasks.length > 1;
    details.classList.toggle('is-open', detailsOpen);
    details.setAttribute('aria-hidden', String(!detailsOpen));
    details.inert = !detailsOpen;
    const existingRows = new Map([...list.children].map(row => [row.dataset.taskId, row]));
    for (const task of tasks) {
      let row = existingRows.get(task.id);
      if (!row) {
        row = document.createElement('div');
        row.dataset.taskId = task.id;
        const light = document.createElement('span');
        light.className = 'dynamic-island-task-light';
        light.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.className = 'dynamic-island-task-text';
        const state = document.createElement('span');
        state.className = 'dynamic-island-task-state';
        row.append(light, text, state);
      }
      row.className = `dynamic-island-task is-${task.state}`;
      row.querySelector('.dynamic-island-task-text').textContent = task.message;
      row.querySelector('.dynamic-island-task-state').textContent = islandStateLabel(task.state);
      list.append(row);
      existingRows.delete(task.id);
    }
    existingRows.forEach(row => row.remove());
  }
}
function updateTaskNotice(id, message, { state = 'progress', duration = 0, progress = null } = {}) {
  const timer = islandTaskTimers.get(id);
  if (timer) clearTimeout(timer);
  islandTaskTimers.delete(id);
  if (!message) islandTasks.delete(id);
  else {
    const priority = ({ progress: 100, saving: 90, error: 80, playing: 75, paused: 75, dirty: 70, complete: 60, waiting: 20 })[state] || 50;
    islandTasks.set(id, { id, message, state, priority, progress, updatedAt: Date.now() });
    if (duration > 0) islandTaskTimers.set(id, setTimeout(() => {
      islandTasks.delete(id);
      islandTaskTimers.delete(id);
      if (![...islandTasks.values()].some(task => task.id === id)) islandExpanded = false;
      renderTaskIsland();
    }, duration));
  }
  if (islandTasks.size < 2) islandExpanded = false;
  renderTaskIsland();
}
function playbackTaskMessage(state) {
  const english = getLanguage() === 'en';
  const title = playbackLabel || (english ? 'Current mix' : 'Mix actuel');
  const duration = timelineDuration();
  const offset = state === 'playing' && audioCtx ? Math.max(0, audioCtx.currentTime - playStartedAt) : playheadOffset;
  return state === 'playing'
    ? `${title} · ${formatTime(offset)} / ${formatTime(duration)}`
    : `${title} · ${english ? 'Paused' : 'En pause'} · ${formatTime(offset)}`;
}
function refreshPlaybackTask(state) {
  if (state !== 'playing' && state !== 'paused') return updateTaskNotice('playback', '');
  const duration = timelineDuration();
  const offset = state === 'playing' && audioCtx ? Math.max(0, audioCtx.currentTime - playStartedAt) : playheadOffset;
  const progress = duration > 0 ? Math.min(100, offset / duration * 100) : 0;
  updateTaskNotice('playback', playbackTaskMessage(state), { state, progress });
}
function syncPlaybackTask(state) {
  if (playbackIslandTimer) clearInterval(playbackIslandTimer);
  playbackIslandTimer = null;
  refreshPlaybackTask(state);
  if (state === 'playing') playbackIslandTimer = setInterval(() => refreshPlaybackTask('playing'), 1000);
}
export function setPlaybackLabel(label) {
  playbackLabel = String(label || '').trim();
  if (playing) refreshPlaybackTask(paused ? 'paused' : 'playing');
}
$('#statusMoreButton')?.addEventListener('click', () => {
  islandExpanded = !islandExpanded;
  renderTaskIsland();
});
document.addEventListener('pointerdown', event => {
  if (!islandExpanded || $('#status')?.contains(event.target)) return;
  islandExpanded = false;
  renderTaskIsland();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !islandExpanded) return;
  islandExpanded = false;
  renderTaskIsland();
});
renderTaskIsland();
onLanguageChange(() => { renderTaskIsland(); if (playing) refreshPlaybackTask(paused ? 'paused' : 'playing'); });
export function status(message, error = false, persistent = false) {
  if (!message) return updateTaskNotice('notice', '');
  updateTaskNotice(persistent ? 'operation' : 'notice', message, {
    state: persistent ? (error ? 'error' : 'progress') : (error ? 'error' : 'complete'),
    duration: persistent ? 0 : error ? 6000 : 3600,
  });
}
export function startSeparationProgressPolling(requestId) {
  if (separationPollTimer) clearInterval(separationPollTimer);
  activeSeparationRequestId = requestId;
  separationPollTimer = setInterval(async () => {
    if (separationPollBusy || activeSeparationRequestId !== requestId) return;
    separationPollBusy = true;
    try {
      const progress = await apiJson(`/api/separations/${requestId}`);
      if (activeSeparationRequestId !== requestId) return;
      if (progress.status === 'canceling') status(t('status.canceling'), false, true);
      else if (progress.status === 'cancelled') status(t('status.cancelled'));
      else if (['preparing', 'queued', 'running', 'completed'].includes(progress.status) && Number.isFinite(progress.progress)) {
        const percent = Math.max(0, Math.min(100, Math.round(progress.progress)));
        status(t('status.progress', { percent }), false, true);
      }
    } catch { /* The route becomes visible once the upload reaches the server handler. */ }
    finally { separationPollBusy = false; }
  }, 700);
}
export function stopSeparationProgressPolling() {
  if (separationPollTimer) clearInterval(separationPollTimer);
  separationPollTimer = undefined;
  activeSeparationRequestId = null;
  separationPollBusy = false;
  updateTaskNotice('operation', '');
}
export function ensureAudioContext() { if (!audioCtx || audioCtx.state === 'closed') audioCtx = new AudioContext(); return audioCtx; }
export function getAudioContext() { return audioCtx; }
export function automationValue(name, parameter, time, fallback) {
  const points = automationByTrack[name]?.lanes?.[parameter];
  if (!points?.length) return fallback;
  const ordered = [...points].sort((a, b) => a.time - b.time);
  if (time <= ordered[0].time) return ordered[0].value;
  if (time >= ordered.at(-1).time) return ordered.at(-1).value;
  const rightIndex = ordered.findIndex(point => point.time >= time);
  const left = ordered[rightIndex - 1], right = ordered[rightIndex];
  const progress = (time - left.time) / Math.max(0.001, right.time - left.time);
  return left.value + (right.value - left.value) * progress;
}
export function settings(name, offset = playheadOffset) {
  // Read the native controls on demand so live playback and offline export agree.
  const rawVolume = +document.querySelector(`[data-control="${name}"][data-param="volume"]`).value;
  const volume = automationValue(name, 'volume', offset, rawVolume) / 100;
  const pan = +document.querySelector(`[data-control="${name}"][data-param="pan"]`).value / 100;
  const solo = document.querySelector(`[data-solo="${name}"]`)?.getAttribute('aria-pressed') === 'true';
  const anySolo = document.querySelector('[data-solo][aria-pressed="true"]') !== null;
  const muted = document.querySelector(`[data-mute="${name}"]`).getAttribute('aria-pressed') === 'true';
  const effects = { ...(effectsByTrack[name] || effectDefaults) };
  Object.keys(effects).forEach(key => { effects[key] = automationValue(name, key, offset, effects[key]); });
  return { volume, pan, solo, muted: muted || (anySolo && !solo), effects };
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
function meterElements(name) {
  return {
    bar: document.querySelector(`[data-track-meter-bar="${name}"]`),
    value: document.querySelector(`[data-track-meter-value="${name}"]`),
    meter: document.querySelector(`[data-track-meter="${name}"]`),
  };
}
export function updateTrackMeters() {
  for (const [name, nodes] of liveNodes) {
    if (!nodes.meterAnalyser || !nodes.meterSamples) continue;
    nodes.meterAnalyser.getFloatTimeDomainData(nodes.meterSamples);
    let peak = 0;
    for (const sample of nodes.meterSamples) peak = Math.max(peak, Math.abs(sample));
    const db = peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
    const { bar, value, meter } = meterElements(name);
    if (!bar || !value || !meter) continue;
    const level = Math.max(0, Math.min(100, ((db + 60) / 66) * 100));
    bar.style.width = `${level}%`;
    bar.classList.toggle('is-hot', db >= -1);
    value.textContent = db <= -59.5 ? '−∞' : `${db.toFixed(1)} dB`;
    meter.setAttribute('aria-valuenow', db.toFixed(1));
    meter.setAttribute('aria-valuetext', value.textContent);
  }
}
export function clearTrackMeters() {
  document.querySelectorAll('[data-track-meter-bar]').forEach(bar => { bar.style.width = '0%'; bar.classList.remove('is-hot'); });
  document.querySelectorAll('[data-track-meter-value]').forEach(value => { value.textContent = '−∞'; });
  document.querySelectorAll('[data-track-meter]').forEach(meter => { meter.setAttribute('aria-valuenow', '-60'); meter.setAttribute('aria-valuetext', '−∞'); });
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
  nodes?.meterAnalyser?.disconnect();
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
  const meterAnalyser = context.createAnalyser();
  meterAnalyser.fftSize = 2048;
  (ducking?.gain || panner).connect(meterAnalyser);
  meterAnalyser.connect(destination);

  return { gain, panner, meterAnalyser, meterSamples: new Float32Array(meterAnalyser.fftSize), effects: { eq, filters, compressor, width, bassBoost, saturation, reverb, delay, ducking, ...modulationEffects } };
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
  const zoom = Number(canvas.closest('[data-track]')?.dataset.timelineZoom || 1);
  const width = Math.max(120, canvas.clientWidth), height = Math.max(40, canvas.clientHeight);
  canvas.width = width * ratio; canvas.height = height * ratio;
  const ctx = canvas.getContext('2d'), graphHeight = height - 20; ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, height);
  const data = buffer.getChannelData(0), step = Math.max(1, Math.floor(data.length / width));
  ctx.strokeStyle = name === 'vocals' ? '#f2a9e1' : '#8cdbff'; ctx.globalAlpha = .9; ctx.lineWidth = 1;
  ctx.beginPath(); for (let x = 0; x < width; x++) { let min = 1, max = -1; const start = x * step; for (let i = 0; i < step && start + i < data.length; i++) { const value = data[start + i]; if (value < min) min = value; if (value > max) max = value; } const y1 = (1 + min) * graphHeight / 2, y2 = (1 + max) * graphHeight / 2; ctx.moveTo(x, y1); ctx.lineTo(x, y2); } ctx.stroke();
  ctx.globalAlpha = .42; ctx.strokeStyle = '#69717e'; ctx.fillStyle = '#aeb5c0'; ctx.font = '9px DM Mono, monospace'; ctx.lineWidth = 1;
  const stepSeconds = tickStep(buffer.duration / zoom); for (let t = 0; t <= buffer.duration; t += stepSeconds) { const x = (t / buffer.duration) * width; ctx.beginPath(); ctx.moveTo(x + .5, graphHeight + 1); ctx.lineTo(x + .5, graphHeight + 5); ctx.stroke(); if (x < width - 22) ctx.fillText(formatTime(t), x + 3, height - 5); }
  const automation = automationByTrack[name]; if (automation) {
    const lane = automation.activeLane || 'pan';
    const points = lane === 'pan' ? automation.points : (automation.lanes?.[lane] || []);
    const [min, max] = automationRanges[lane] || [0, 100];
    const base = automationBaseValue(name, lane);
    const pointValue = point => lane === 'pan' ? point.pan : point.value;
    const valueAt = time => lane === 'pan' ? getAutomationPan(name, time) : automationValue(name, lane, time, base);
    const pointsOnGraph = points.map(point => ({ x: (point.time / buffer.duration) * width, y: graphHeight * (1 - (pointValue(point) - min) / Math.max(0.001, max - min)) }));
    ctx.globalAlpha = .92; ctx.strokeStyle = lane === 'pan' ? '#a78bfa' : '#d7ff54'; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = 0; x < width; x += 1) {
      const time = (x / Math.max(1, width - 1)) * buffer.duration;
      const value = Math.max(min, Math.min(max, valueAt(time)));
      const y = graphHeight * (1 - (value - min) / Math.max(0.001, max - min));
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    pointsOnGraph.forEach((point, index) => { ctx.fillStyle = index === automation.selected ? '#ffffff' : (lane === 'pan' ? '#a78bfa' : '#d7ff54'); ctx.beginPath(); ctx.arc(point.x, point.y, index === automation.selected ? 5 : 4, 0, Math.PI * 2); ctx.fill(); });
  }
}
export function bindTrackTimelineZoom() {
  const tracksRoot = $('#tracks');
  if (!tracksRoot) return;
  const updatePinnedControls = track => {
    const waveArea = track.querySelector('.wave-area');
    const controls = track.querySelector('.automation-tools');
    if (!waveArea || !controls) return;
    controls.style.width = track.classList.contains('is-timeline-zoomed') ? `${waveArea.clientWidth}px` : '';
  };
  let observer = tracksRoot._timelineZoomObserver;
  if (!observer) {
    observer = new ResizeObserver(entries => entries.forEach(entry => updatePinnedControls(entry.target.closest('[data-track]'))));
    tracksRoot._timelineZoomObserver = observer;
  }
  observer.disconnect();
  tracksRoot.querySelectorAll('.wave-area').forEach(area => observer.observe(area));
  tracksRoot.querySelectorAll('[data-track]').forEach(updatePinnedControls);
  tracksRoot.onwheel = event => {
    if (!event.ctrlKey) return;
    const track = event.target.closest?.('[data-track]');
    if (!track || !tracksRoot.contains(track)) return;
    event.preventDefault();
    const zoomSteps = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];
    const current = Number(track.dataset.timelineZoom || 1);
    const currentIndex = zoomSteps.reduce((best, value, index) => Math.abs(value - current) < Math.abs(zoomSteps[best] - current) ? index : best, 0);
    const next = zoomSteps[Math.max(0, Math.min(zoomSteps.length - 1, currentIndex + (event.deltaY < 0 ? 1 : -1)))];
    if (next === current) return;
    track.dataset.timelineZoom = String(next);
    track.classList.toggle('is-timeline-zoomed', next > 1);
    const content = track.querySelector('[data-wave-content]');
    if (content) content.style.width = `${next * 100}%`;
    updatePinnedControls(track);
    if (tracks[track.dataset.track]) drawWaveform(track.dataset.track, tracks[track.dataset.track]);
    updatePlayheads();
  };
}
export const stemInfo = {
  vocals: { titleKey: 'stem.vocals', detailKey: 'stem.vocalsDetail', icon: 'mic' },
  accompaniment: { titleKey: 'stem.accompaniment', detailKey: 'stem.accompanimentDetail', icon: 'wave' },
  drums: { titleKey: 'stem.drums', detailKey: 'stem.drumsDetail', icon: 'drum' },
  bass: { titleKey: 'stem.bass', detailKey: 'stem.bassDetail', icon: 'bass' },
  other: { titleKey: 'stem.other', detailKey: 'stem.otherDetail', icon: 'spark' },
};
export function icon(name) {
  const names = { mic: 'mic', wave: 'audio-lines', drum: 'drum', bass: 'bass', spark: 'sparkles' };
  return lucideIcon(names[name] || name);
}
export function speakerIcon(muted = false) { return lucideIcon(muted ? 'volume-x' : 'volume-2'); }
export function playIcon() { return lucideIcon('play'); }
export function pauseIcon() { return lucideIcon('pause'); }
export function stopIcon() { return lucideIcon('stop', { className: 'transport-stop-icon' }); }
export function setTransportState(state = 'stopped') {
  const playButton = $('#playButton'), stopButton = $('#stopButton');
  const isPlaying = state === 'playing', isPaused = state === 'paused';
  const hasTracks = Object.keys(tracks).length > 0;
  playButton.disabled = !hasTracks;
  playButton.innerHTML = isPlaying ? pauseIcon() : playIcon();
  stopButton.innerHTML = stopIcon();
  const playLabel = isPlaying ? t('pause.title') : isPaused ? t('resume.title') : t('play.title');
  playButton.setAttribute('aria-label', playLabel);
  playButton.title = playLabel;
  stopButton.disabled = !isPlaying && !isPaused;
  syncPlaybackTask(state);
}
const automationRanges = {
  pan: [-100, 100], volume: [0, 150], saturation: [0, 100], bassBoost: [0, 100], compressor: [0, 100],
  eqLow: [-12, 12], eqMid: [-12, 12], eqHigh: [-12, 12], reverb: [0, 100], delay: [0, 100],
  highPass: [0, 100], lowPass: [0, 100], width: [0, 200], ducking: [0, 100], chorus: [0, 100],
  flanger: [0, 100], phaser: [0, 100], tremolo: [0, 100], bitcrusher: [0, 100], gate: [0, 100],
  deEsser: [0, 100], limiter: [0, 100], exciter: [0, 100],
};
export function generateAutomationCurvePoints(name, preset, lane = 'pan') {
  const duration = tracks[name]?.duration;
  const template = generateCurveTemplatePoints(preset, duration);
  if (!template) return null;
  if (lane === 'pan') return template;
  const range = automationRanges[lane];
  if (!range) return null;
  const [min, max] = range;
  return template.map(point => ({
    time: point.time,
    value: Math.round((min + ((point.pan + 100) / 200) * (max - min)) * 10) / 10,
  }));
}
const effectAutomationLanes = {
  eq: ['eqLow', 'eqMid', 'eqHigh'], filters: ['highPass', 'lowPass'],
  compressor: ['compressor'], reverb: ['reverb'], delay: ['delay'], width: ['width'], ducking: ['ducking'],
  saturation: ['saturation'], bassBoost: ['bassBoost'], chorus: ['chorus'], flanger: ['flanger'], phaser: ['phaser'],
  tremolo: ['tremolo'], bitcrusher: ['bitcrusher'], gate: ['gate'], deEsser: ['deEsser'], limiter: ['limiter'], exciter: ['exciter'],
};
function automationBaseValue(name, lane) {
  if (lane === 'pan') return 0;
  if (lane === 'volume') return Number(document.querySelector(`[data-control="${name}"][data-param="volume"]`)?.value ?? 100);
  return Number(effectsByTrack[name]?.[lane] ?? (lane === 'width' ? 100 : 0));
}
function automationPointsFor(name, lane, duration = tracks[name]?.duration || 0) {
  const state = automationByTrack[name];
  if (lane === 'pan') return state.points;
  state.lanes ||= {};
  state.lanes[lane] ||= [{ time: 0, value: automationBaseValue(name, lane) }, { time: duration, value: automationBaseValue(name, lane) }];
  return state.lanes[lane];
}
export function ensureAutomation(name, duration) {
  const state = automationByTrack[name] ||= {};
  Object.assign(state, { points: [{ time: 0, pan: 0 }, { time: duration, pan: 0 }], selected: 0, activeLane: 'pan', activeEffects: [], lanes: {} });
}
export function activateTrackEffect(name, key) {
  if (!trackHasEffect(key, name)) return false;
  const state = automationByTrack[name];
  if (!state) return false;
  state.activeEffects ||= [];
  if (!state.activeEffects.includes(key)) state.activeEffects.push(key);
  const values = effectsByTrack[name] ||= { ...effectDefaults };
  const defaults = { saturation: 16, bassBoost: 24, compressor: 20, eqLow: 2, eqMid: 0, eqHigh: 0, highPass: 2, lowPass: 0, reverb: 18, delay: 18, width: 130, ducking: 20, chorus: 18, flanger: 18, phaser: 18, tremolo: 18, bitcrusher: 18, gate: 18, deEsser: 18, limiter: 18, exciter: 18 };
  for (const lane of effectAutomationLanes[key] || []) {
    if (!values[lane] && lane !== 'width') values[lane] = defaults[lane] ?? 18;
    const points = automationPointsFor(name, lane);
    if (!points.length) points.push({ time: 0, value: values[lane] }, { time: tracks[name].duration, value: values[lane] });
  }
  state.activeLane = (effectAutomationLanes[key] || [])[0] || 'pan';
  refreshAutomation(name);
  markProjectDirty();
  return true;
}
export function automationCoordinates(event, canvas) {
  const name = canvas.dataset.waveform, buffer = tracks[name], rect = canvas.getBoundingClientRect(), graphHeight = rect.height - 20;
  const lane = automationByTrack[name]?.activeLane || 'pan', [min, max] = automationRanges[lane] || [0, 100];
  const y = Math.max(0, Math.min(graphHeight, event.clientY - rect.top));
  const step = lane === 'pan' ? 5 : lane.startsWith('eq') ? .5 : 1;
  const value = Math.max(min, Math.min(max, Math.round((max - y / graphHeight * (max - min)) / step) * step));
  return { time: Math.max(0, Math.min(buffer.duration, ((event.clientX - rect.left) / rect.width) * buffer.duration)), value, lane };
}
export function selectAutomationPoint(event) {
  const canvas = event.currentTarget, name = canvas.dataset.waveform, { time, value, lane } = automationCoordinates(event, canvas), buffer = tracks[name], automation = automationByTrack[name];
  const points = automationPointsFor(name, lane, buffer.duration);
  const closeIndex = points.findIndex(point => Math.abs(point.time - time) < Math.max(.18, buffer.duration * .008));
  if (closeIndex >= 0) automation.selected = closeIndex;
  else {
    const point = lane === 'pan' ? { time, pan: value } : { time, value };
    points.push(point); points.sort((a, b) => a.time - b.time); automation.selected = points.indexOf(point);
  }
  refreshAutomation(name);
  markProjectDirty();
}
export function moveAutomationPoint(event) {
  if (!automationDragging) return;
  const canvas = event.currentTarget, name = canvas.dataset.waveform, automation = automationByTrack[name], lane = automation.activeLane || 'pan', points = automationPointsFor(name, lane), point = points[automation.selected], { time, value } = automationCoordinates(event, canvas), last = points.length - 1;
  if (!point) return;
  if (lane === 'pan') point.pan = value; else point.value = value;
  if (automation.selected > 0 && automation.selected < last) point.time = Math.max(points[automation.selected - 1].time + .05, Math.min(points[automation.selected + 1].time - .05, time));
  refreshAutomation(name);
  markProjectDirty();
}
export function refreshAutomation(name) {
  // Refresh the selected lane, its points, and the effect chips below the shared track curve.
  const automation = automationByTrack[name]; if (!automation) return;
  automation.activeLane ||= 'pan';
  automation.activeEffects ||= [];
  const panCurveButton = document.querySelector(`[data-pan-curves="${name}"]`);
  if (panCurveButton) {
    const parameter = t(`automation.param.${automation.activeLane}`);
    const label = t('panCurves.openFor', { parameter });
    panCurveButton.hidden = false;
    panCurveButton.setAttribute('aria-label', label);
    panCurveButton.title = label;
  }
  const laneButtons = document.querySelector(`[data-automation-lanes="${name}"]`);
  if (laneButtons) {
    const lanes = ['pan', 'volume', ...automation.activeEffects.flatMap(effect => effectAutomationLanes[effect] || [])];
    const laneSignature = lanes.join('|');
    if (laneButtons.dataset.renderedLanes !== laneSignature) {
      laneButtons.innerHTML = lanes.map(lane => `<button type="button" class="automation-lane" data-select-automation-lane="${name}" data-lane="${lane}">${t(`automation.param.${lane}`)}</button>`).join('');
      laneButtons.dataset.renderedLanes = laneSignature;
      laneButtons.querySelectorAll('[data-select-automation-lane]').forEach(button => button.onclick = () => {
        const currentAutomation = automationByTrack[name];
        if (!currentAutomation) return;
        currentAutomation.activeLane = button.dataset.lane;
        currentAutomation.selected = 0;
        refreshAutomation(name);
      });
    }
    laneButtons.querySelectorAll('[data-select-automation-lane]').forEach(button => button.classList.toggle('active', button.dataset.lane === automation.activeLane));
  }
  const points = automationPointsFor(name, automation.activeLane);
  const point = points[automation.selected];
  const time = document.querySelector(`[data-automation-time="${name}"]`);
  if (time && point) {
    const value = automation.activeLane === 'pan' ? point.pan : point.value;
    time.textContent = `${formatTime(point.time)} · ${value}${automation.activeLane === 'volume' ? '%' : ''}`;
  }
  if (tracks[name]) drawWaveform(name, tracks[name]);
  updateLiveMix();
}
export function bindAutomation() {
  document.querySelectorAll('[data-waveform]').forEach(canvas => {
    canvas.addEventListener('pointerdown', event => { selectAutomationPoint(event); automationDragging = true; canvas.setPointerCapture(event.pointerId); });
    canvas.addEventListener('pointermove', moveAutomationPoint);
    canvas.addEventListener('pointerup', event => { automationDragging = false; try { canvas.releasePointerCapture(event.pointerId); } catch {} });
    canvas.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; canvas.classList.add('is-drop-target'); });
    canvas.addEventListener('dragleave', () => canvas.classList.remove('is-drop-target'));
    canvas.addEventListener('drop', event => {
      event.preventDefault(); canvas.classList.remove('is-drop-target');
      let curvePreset;
      try { curvePreset = JSON.parse(event.dataTransfer.getData('application/x-audiosplit-automation-curve')); } catch {}
      if (curvePreset) {
        const name = canvas.dataset.waveform;
        const lane = curvePreset.lane || 'pan';
        const points = curvePreset.track === name ? generateAutomationCurvePoints(name, curvePreset.preset, lane) : null;
        if (!points) {
          status(getLanguage() === 'en' ? 'Drop the curve onto the same track it was opened from.' : 'Déposez la courbe sur la piste depuis laquelle vous l’avez ouverte.', true);
          return;
        }
        const automation = automationByTrack[name];
        if (lane === 'pan') automation.points = points;
        else { automation.lanes ||= {}; automation.lanes[lane] = points; }
        automation.activeLane = lane;
        automation.selected = 0;
        refreshAutomation(name);
        markProjectDirty();
        status(t('panCurves.applied', { parameter: t(`automation.param.${lane}`) }));
        return;
      }
      let payload;
      try { payload = JSON.parse(event.dataTransfer.getData('application/x-audiosplit-effect')); } catch { return; }
      if (!payload?.effect || payload.track !== canvas.dataset.waveform || !activateTrackEffect(canvas.dataset.waveform, payload.effect)) {
        status(getLanguage() === 'en' ? 'That effect is not available on this track.' : 'Cet effet n’est pas disponible sur cette piste.', true);
        return;
      }
      status(getLanguage() === 'en' ? 'Effect added to the track curve.' : 'Effet ajouté à la courbe de la piste.');
    });
  });
  document.querySelectorAll('[data-pan-curves]').forEach(button => button.onclick = () => panCurveModalInstance?.open(button.dataset.panCurves));
  document.querySelectorAll('[data-automation-remove]').forEach(remove => remove.onclick = () => {
    const name = remove.dataset.automationRemove, automation = automationByTrack[name], lane = automation.activeLane || 'pan', points = automationPointsFor(name, lane);
    if (automation.selected > 0 && automation.selected < points.length - 1) { points.splice(automation.selected, 1); automation.selected--; refreshAutomation(name); markProjectDirty(); }
  });
}
export let fxModalInstance;
export function setFxModal(modal) { fxModalInstance = modal; }
export let panCurveModalInstance;
export function setPanCurveModal(modal) { panCurveModalInstance = modal; }
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
    const source = audioCtx.createBufferSource(), cfg = settings(name, offset), nodes = createTrackNodes(audioCtx, source, name, cfg, liveMaster);
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
    updateTrackMeters();
    for (const [name, nodes] of liveNodes) {
      const offset = Math.max(0, audioCtx.currentTime - playStartedAt);
      const config = settings(name, offset);
      nodes.gain.gain.setTargetAtTime(config.muted ? 0 : config.volume, audioCtx.currentTime, 0.018);
      if (nodes.effects.ducking) updateVoiceDucking(nodes.effects.ducking, voiceLevel, config.effects.ducking, audioCtx, true);
      if (nodes.effects.deEsser) updateDeEsser(nodes.effects.deEsser, config.effects.deEsser, audioCtx, true);
      if (nodes.effects.gate) updateNoiseGate(nodes.effects.gate, config.effects.gate, audioCtx, true);
      if (Object.keys(automationByTrack[name]?.lanes || {}).some(key => key !== 'volume' && !['ducking', 'deEsser', 'gate'].includes(key))) updateTrackEffects(nodes, config.effects, audioCtx, voiceLevel);
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
  liveNodes.forEach(nodes => {
    nodes.source.onended = null;
    try { nodes.source.stop(); } catch {}
    disposeTrackNodes(nodes);
  });
  liveNodes = new Map();
  clearTrackMeters();
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
        playheadOffset = Math.max(0, audioCtx.currentTime - playStartedAt);
        updatePlayheads(playheadOffset);
        setTransportState('paused');
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
