import { createBassSaturation, updateBassSaturation } from './js/effects/bass-saturation.js';
import { createCompressor, updateCompressor } from './js/effects/compressor.js';
import { createThreeBandEq, updateThreeBandEq } from './js/effects/three-band-eq.js';
import { createReverb, updateReverb } from './js/effects/reverb.js';
import { createDelay, updateDelay } from './js/effects/delay.js';
import { createFilters, updateFilters } from './js/effects/filters.js';
import { createStereoWidth, updateStereoWidth } from './js/effects/stereo-width.js?v=1.2';
import { createVoiceDucker, createVoiceMeter, readVoiceLevel, scheduleOfflineVoiceDucking, updateVoiceDucking } from './js/effects/voice-ducking.js';
import { createChangelogModal, createFxModal, createLanguageModal, mountModalComponents } from './js/modal-manager.js?v=1.2';
import { applyTranslations, getLanguage, onLanguageChange, t } from './js/i18n.js?v=1.2';

// Small DOM helper kept in the entry module so the UI code stays readable.
const $ = (sel) => document.querySelector(sel);
const tracks = {};
const automationByTrack = {};
const effectDefaults = { saturation: 0, compressor: 0, eqLow: 0, eqMid: 0, eqHigh: 0, reverb: 0, delay: 0, highPass: 0, lowPass: 0, width: 100, ducking: 0 };
const effectsByTrack = {};
let audioCtx, liveNodes = new Map(), playing = false, paused = false, playStartedAt = 0, automationDragging = false, playheadFrame, playbackToken = 0, saturationTarget = 'accompaniment', widthTarget = 'accompaniment', voiceMeter;
let fxModal, changelogModal, languageModal;

function status(message, error = false) {
  // The import card is the single place where asynchronous work reports status.
  const target = $('#status'); target.textContent = message; target.style.color = error ? '#ff987f' : '';
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
  for (let i = 1; i < points.length; i++) { const next = points[i], previous = points[i - 1]; if (time <= next.time) { const ratio = (time - previous.time) / (next.time - previous.time); return previous.pan + (next.pan - previous.pan) * ratio; } }
  return points.at(-1).pan;
}
function combinedPan(pointPan, cfg) { return Math.max(-1, Math.min(1, pointPan / 100 + cfg.pan)); }
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
  const compressor = ['vocals', 'bass'].includes(name) ? createCompressor(context, filters.output, cfg.effects.compressor) : null;
  const width = name === widthTarget ? createStereoWidth(context, compressor?.output || filters.output, cfg.effects.width) : null;
  const mainOutput = width?.output || compressor?.output || filters.output;
  mainOutput.connect(panner);

  // Parallel processors add ambience or grit without replacing the dry track.
  const saturation = name === saturationTarget ? createBassSaturation(context, mainOutput, panner, cfg.effects.saturation) : null;
  const reverb = name === 'vocals' ? createReverb(context, mainOutput, panner, cfg.effects.reverb) : null;
  const delay = name === 'vocals' ? createDelay(context, mainOutput, panner, cfg.effects.delay) : null;
  const ducking = name !== 'vocals' ? createVoiceDucker(context, panner) : null;
  (ducking?.gain || panner).connect(destination);

  return { gain, panner, effects: { eq, filters, compressor, width, saturation, reverb, delay, ducking } };
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
}
function schedulePan(panner, name, cfg, startAt, offset = 0) {
  panner.pan.cancelScheduledValues(startAt);
  const automation = automationByTrack[name];
  if (!automation?.points.length) { panner.pan.setValueAtTime(cfg.pan, startAt); return; }
  panner.pan.setValueAtTime(combinedPan(getAutomationPan(name, offset), cfg), startAt);
  automation.points.filter(point => point.time > offset).forEach(point => panner.pan.linearRampToValueAtTime(combinedPan(point.pan, cfg), startAt + point.time - offset));
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
  const automation = automationByTrack[name]; if (automation?.points.length) { const points = automation.points.map(point => ({ x: (point.time / buffer.duration) * width, y: graphHeight * (1 - (point.pan + 100) / 200) })); ctx.globalAlpha = 1; ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); for (let i = 0; i < points.length - 1; i++) { const p0 = points[i - 1] || points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] || p2; ctx.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y); } ctx.stroke(); points.forEach((point, index) => { ctx.fillStyle = index === automation.selected ? '#d7ff54' : '#a78bfa'; ctx.beginPath(); ctx.arc(point.x, point.y, index === automation.selected ? 5 : 4, 0, Math.PI * 2); ctx.fill(); }); }
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
}
function moveAutomationPoint(event) {
  if (!automationDragging) return;
  const canvas = event.currentTarget, name = canvas.dataset.waveform, automation = automationByTrack[name], point = automation.points[automation.selected], { time, pan } = automationCoordinates(event, canvas), last = automation.points.length - 1;
  point.pan = pan;
  if (automation.selected > 0 && automation.selected < last) point.time = Math.max(automation.points[automation.selected - 1].time + .05, Math.min(automation.points[automation.selected + 1].time - .05, time));
  refreshAutomation(name);
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
  document.querySelectorAll('[data-automation-pan]').forEach(button => button.onclick = () => { const name = button.dataset.automationPan, automation = automationByTrack[name], point = automation.points[automation.selected]; if (!point) return; point.pan = +button.dataset.pan; refreshAutomation(name); });
  document.querySelectorAll('[data-automation-remove]').forEach(remove => remove.onclick = () => { const name = remove.dataset.automationRemove, automation = automationByTrack[name]; if (automation.selected > 0 && automation.selected < automation.points.length - 1) { automation.points.splice(automation.selected, 1); automation.selected--; refreshAutomation(name); } });
}
function bindFxButtons() {
  // Track buttons are generated after a separation, so bind them after every render.
  document.querySelectorAll('[data-fx]').forEach(button => button.onclick = () => fxModal?.open(button.dataset.fx));
}
function updatePlayheads(offset = 0) {
  document.querySelectorAll('[data-playhead]').forEach(playhead => {
    const buffer = tracks[playhead.dataset.playhead];
    const position = playing && buffer ? Math.min(100, Math.max(0, (offset / buffer.duration) * 100)) : 0;
    playhead.style.left = `${position}%`;
    playhead.classList.toggle('is-playing', playing);
  });
}
function animatePlayheads() {
  if (!playing || !audioCtx) { playheadFrame = undefined; updatePlayheads(); return; }
  if (paused) { playheadFrame = undefined; updatePlayheads(Math.max(0, audioCtx.currentTime - playStartedAt)); return; }
  // Ducking shares the animation clock with the playhead to avoid another loop.
  const voiceLevel = voiceMeter ? readVoiceLevel(voiceMeter) : 0;
  for (const [name, nodes] of liveNodes) {
    if (nodes.effects.ducking) updateVoiceDucking(nodes.effects.ducking, voiceLevel, settings(name).effects.ducking, audioCtx, true);
  }
  updatePlayheads(Math.max(0, audioCtx.currentTime - playStartedAt));
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
function renderTracks(names, savedControls = {}) {
  // Detailed splits expose a bass stem; simple splits use accompaniment as the bass source.
  saturationTarget = names.includes('bass') ? 'bass' : 'accompaniment';
  widthTarget = names.includes('other') ? 'other' : 'accompaniment';
  names.forEach(name => { effectsByTrack[name] ??= { ...effectDefaults }; });
  $('#tracks').innerHTML = names.map((name) => {
    const info = stemInfo[name], trackTitle = t(info.titleKey), trackDetail = t(info.detailKey), saved = savedControls[name] || {};
    const volume = saved.volume ?? 100, pan = saved.pan ?? 0, muted = saved.muted ?? false;
    const automation = `<div class="automation-tools"><span>${t('automation.pan', { track: trackTitle.toLowerCase() })}</span><span class="automation-time" data-automation-time="${name}">0:00</span><button type="button" data-automation-pan="${name}" data-pan="-100">${t('automation.left')}</button><button type="button" data-automation-pan="${name}" data-pan="0">${t('automation.center')}</button><button type="button" data-automation-pan="${name}" data-pan="100">${t('automation.right')}</button><button type="button" class="remove-point" data-automation-remove="${name}" title="${t('automation.remove')}">×</button></div>`;
    return `<article class="track ${name}"><div class="track-icon">${icon(info.icon)}</div><div class="track-title"><h3>${trackTitle}</h3><p>${trackDetail}</p></div><button type="button" class="fx-button" data-fx="${name}" title="${t('fx.open', { track: trackTitle })}">Fx</button><div class="pan-fader" title="${t('control.panTitle')}"><span class="pan-letter">L</span><div class="gauge pan-gauge"><i></i><input aria-label="${t('control.pan', { track: trackTitle })}" data-control="${name}" data-param="pan" type="range" min="-100" max="100" value="${pan}"></div><output id="${name}PanOut">${pan}</output><span class="pan-letter">R</span></div><div class="wave-area"><canvas class="waveform" data-waveform="${name}" aria-label="${trackTitle}"></canvas><span class="playhead" data-playhead="${name}" aria-hidden="true"></span>${automation}</div><div class="volume-stack"><button class="mute" data-mute="${name}" aria-pressed="${muted}" title="${t('control.mute', { track: trackTitle })}">${speakerIcon(muted)}</button><div class="volume-fader" title="${t('control.volumeTitle')}"><div class="gauge volume-gauge"><i></i><input aria-label="${t('control.volume', { track: trackTitle })}" data-control="${name}" data-param="volume" type="range" min="0" max="150" value="${volume}"></div><output id="${name}VolumeOut">${volume}</output></div></div></article>`;
  }).join('');
  document.querySelectorAll('[data-control]').forEach(el => el.oninput = updateOutputs);
  document.querySelectorAll('[data-mute]').forEach(button => button.onclick = () => { const muted = button.getAttribute('aria-pressed') === 'true'; button.setAttribute('aria-pressed', String(!muted)); button.innerHTML = speakerIcon(!muted); updateLiveMix(); });
  bindAutomation();
  bindFxButtons();
  updateOutputs();
}
// Stop all live nodes together because every stem starts at the same audio clock time.
function stop() {
  playbackToken += 1;
  if (playheadFrame) cancelAnimationFrame(playheadFrame);
  playheadFrame = undefined;
  voiceMeter = undefined;
  liveNodes.forEach(({ source }) => {
    source.onended = null;
    try { source.stop(); } catch {}
  });
  liveNodes = new Map();
  playing = false;
  paused = false;
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
        updatePlayheads(Math.max(0, audioCtx.currentTime - playStartedAt));
      }
    } catch (error) {
      status(t('status.playbackChange', { error: error.message }), true);
    }
    return;
  }

  if (!Object.keys(tracks).length) return;
  stop();
  if (!audioCtx || audioCtx.state === 'closed') audioCtx = new AudioContext();
  try {
    // A context created after a long Demucs task is commonly suspended by Chrome.
    await audioCtx.resume();
    playStartedAt = audioCtx.currentTime;
    const token = ++playbackToken;
    const totalSources = Object.keys(tracks).length;
    let completedSources = 0;
    playing = true;
    paused = false;
    setTransportState('playing');

    for (const [name, buffer] of Object.entries(tracks)) {
      const source = audioCtx.createBufferSource(), cfg = settings(name), nodes = createTrackNodes(audioCtx, source, name, cfg, audioCtx.destination);
      source.buffer = buffer;
      schedulePan(nodes.panner, name, cfg, playStartedAt);
      source.onended = () => {
        if (token !== playbackToken) return;
        completedSources += 1;
        if (completedSources === totalSources) stop();
      };
      source.start();
      liveNodes.set(name, { source, ...nodes });
    }

    // The vocal meter drives every instrumental ducking node during playback.
    if (liveNodes.has('vocals')) voiceMeter = createVoiceMeter(audioCtx, liveNodes.get('vocals').gain);
    updatePlayheads();
    playheadFrame = requestAnimationFrame(animatePlayheads);
  } catch (error) {
    stop();
    console.error('Audio playback could not start.', error);
    status(t('status.playbackStart', { error: error.message }), true);
  }
}
function wavBlob(buffer) {
  const channels = buffer.numberOfChannels, length = buffer.length * channels * 2, out = new ArrayBuffer(44 + length), view = new DataView(out);
  const write = (offset, str) => [...str].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0,'RIFF'); view.setUint32(4,36+length,true); write(8,'WAVE'); write(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,channels,true); view.setUint32(24,buffer.sampleRate,true); view.setUint32(28,buffer.sampleRate*channels*2,true); view.setUint16(32,channels*2,true); view.setUint16(34,16,true); write(36,'data'); view.setUint32(40,length,true);
  let at=44; for(let i=0;i<buffer.length;i++) for(let ch=0;ch<channels;ch++){let s=Math.max(-1,Math.min(1,buffer.getChannelData(ch)[i]));view.setInt16(at,s<0?s*0x8000:s*0x7fff,true);at+=2;} return new Blob([out],{type:'audio/wav'});
}
async function exportMix() {
  // OfflineAudioContext renders the current mix without recording speaker output.
  stop(); const duration = Math.max(...Object.values(tracks).map(b => b.duration)), rate = tracks.vocals.sampleRate;
  const offline = new OfflineAudioContext(2, Math.ceil(duration * rate), rate);
  const offlineNodes = new Map();
  for (const [name, buffer] of Object.entries(tracks)) { const source=offline.createBufferSource(),cfg=settings(name),nodes=createTrackNodes(offline,source,name,cfg,offline.destination); source.buffer=buffer;schedulePan(nodes.panner,name,cfg,0);source.start();offlineNodes.set(name,nodes); }
  // Offline rendering has no animation frame, so schedule the vocal envelope in advance.
  if (tracks.vocals) for (const [name, nodes] of offlineNodes) if (nodes.effects.ducking) scheduleOfflineVoiceDucking(nodes.effects.ducking, tracks.vocals, settings(name).effects.ducking, offline);
  status(t('status.rendering')); const rendered=await offline.startRendering(), url=URL.createObjectURL(wavBlob(rendered)), link=document.createElement('a');link.href=url;link.download='audiosplit-mix-stereo.wav';link.click();URL.revokeObjectURL(url);status(t('status.exported'));
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
  const cacheButton = $('#clearCacheButton');
  const mode = document.querySelector('input[name="splitMode"]:checked').value;
  const engine = document.querySelector('input[name="engine"]:checked').value;
  button.disabled = true;
  cacheButton.disabled = true;
  status(engine === 'fast' ? t('status.fast') : t('status.studio'));
  const form = new FormData();
  form.append('file', file);
  form.append('mode', mode);
  form.append('engine', engine);
  form.append('language', getLanguage());

  try {
    const response = await fetch('/api/separate', { method: 'POST', body: form });
    const data = await response.json();
    if (!response.ok) throw Error(data.detail || t('status.separationError'));

    // Decoding completes before the mixer is rendered, preventing a half-ready UI.
    if (!audioCtx || audioCtx.state === 'closed') audioCtx = new AudioContext();
    const names = Object.keys(data.stems);
    const decoded = await Promise.all(names.map(async (name) => [
      name,
      await fetch(`${data.stems[name]}?lang=${getLanguage()}`).then(async (stemResponse) => {
        if (!stemResponse.ok) throw Error(t('status.trackMissing', { track: t(stemInfo[name].titleKey) }));
        return audioCtx.decodeAudioData(await stemResponse.arrayBuffer());
      }),
    ]));

    stop();
    Object.keys(tracks).forEach((name) => delete tracks[name]);
    Object.keys(effectsByTrack).forEach((name) => delete effectsByTrack[name]);
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
    status(data.cacheHit ? t('status.cached') : t('status.finished'));
  } catch (error) {
    console.error('Audio separation failed.', error);
    status(error.message, true);
  } finally {
    button.disabled = !$('#fileInput').files[0];
    cacheButton.disabled = false;
  }
}

async function clearAudioSplitCache() {
  const button = $('#clearCacheButton');
  button.disabled = true;
  try {
    const response = await fetch(`/api/cache?lang=${getLanguage()}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw Error(data.detail || t('status.cacheError'));
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
$('#clearCacheButton').onclick = () => { void clearAudioSplitCache(); };
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
      setValue: (name, key, value) => { effectsByTrack[name][key] = value; updateLiveMix(); },
    });
    changelogModal = createChangelogModal($('#versionButton'));
    languageModal = createLanguageModal($('#languageButton'));
    bindFxButtons();
  } catch (error) {
    // A missing component should not block audio separation or mixing.
    console.error('Modal components could not be loaded.', error);
    $('#versionButton').disabled = true;
  }
}
onLanguageChange(() => {
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
document.addEventListener('keydown', event => { if (event.key === 'Escape') { fxModal?.close(); changelogModal?.close(); languageModal?.close(); } });
window.addEventListener('resize',()=>Object.entries(tracks).forEach(([name, buffer])=>buffer&&drawWaveform(name,buffer)));
