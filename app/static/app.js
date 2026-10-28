const $ = (sel) => document.querySelector(sel);
const tracks = {};
const automationByTrack = {};
const saturationByTrack = { accompaniment: 0, bass: 0 };
let audioCtx, liveNodes = new Map(), playing = false, playStartedAt = 0, automationDragging = false, fxCloseTimer, changelogCloseTimer, playheadFrame, saturationTarget = 'accompaniment';

function status(message, error = false) {
  const target = $('#status'); target.textContent = message; target.style.color = error ? '#ff987f' : '';
}
function settings(name) {
  const volume = +document.querySelector(`[data-control="${name}"][data-param="volume"]`).value / 100;
  const pan = +document.querySelector(`[data-control="${name}"][data-param="pan"]`).value / 100;
  return { volume, pan, muted: document.querySelector(`[data-mute="${name}"]`).getAttribute('aria-pressed') === 'true', saturation: saturationByTrack[name] || 0 };
}
function updateLiveMix() {
  if (!audioCtx || !playing) return;
  for (const [name, nodes] of liveNodes) {
    const cfg = settings(name), now = audioCtx.currentTime;
    nodes.gain.gain.setTargetAtTime(cfg.muted ? 0 : cfg.volume, now, 0.012);
    schedulePan(nodes.panner, name, cfg, now, Math.max(0, now - playStartedAt));
    if (nodes.saturation) configureSaturation(nodes.saturation, cfg.saturation, audioCtx, true);
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
function saturationCurve(amount) {
  const size = 2048, curve = new Float32Array(size), drive = 1 + Math.max(0, Math.min(100, amount)) * .3, normalizer = Math.tanh(drive);
  for (let index = 0; index < size; index++) { const sample = (index * 2 / (size - 1)) - 1; curve[index] = Math.tanh(drive * sample) / normalizer; }
  return curve;
}
function configureSaturation(effect, amount, context, smooth = false) {
  const intensity = Math.max(0, Math.min(100, amount));
  effect.shaper.curve = saturationCurve(intensity);
  const wetLevel = (intensity / 100) * .36;
  if (smooth) effect.wet.gain.setTargetAtTime(wetLevel, context.currentTime, .012);
  else effect.wet.gain.setValueAtTime(wetLevel, context.currentTime);
}
function addBassSaturation(context, input, panner, amount) {
  const filter = context.createBiquadFilter(), shaper = context.createWaveShaper(), wet = context.createGain();
  filter.type = 'lowpass'; filter.frequency.value = 240; filter.Q.value = .8; shaper.oversample = '4x';
  input.connect(filter).connect(shaper).connect(wet).connect(panner);
  const effect = { filter, shaper, wet }; configureSaturation(effect, amount, context); return effect;
}
function createTrackNodes(context, source, name, cfg, destination) {
  const gain = context.createGain(), panner = context.createStereoPanner();
  gain.gain.value = cfg.muted ? 0 : cfg.volume; source.connect(gain).connect(panner);
  const saturation = name === saturationTarget ? addBassSaturation(context, gain, panner, cfg.saturation) : null;
  panner.connect(destination); return { gain, panner, saturation };
}
function schedulePan(panner, name, cfg, startAt, offset = 0) {
  panner.pan.cancelScheduledValues(startAt);
  const automation = automationByTrack[name];
  if (!automation?.points.length) { panner.pan.setValueAtTime(cfg.pan, startAt); return; }
  panner.pan.setValueAtTime(combinedPan(getAutomationPan(name, offset), cfg), startAt);
  automation.points.filter(point => point.time > offset).forEach(point => panner.pan.linearRampToValueAtTime(combinedPan(point.pan, cfg), startAt + point.time - offset));
}
function drawWaveform(name, buffer) {
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
  vocals: { title: 'Voix', detail: 'Stem vocal extrait', icon: 'mic' },
  accompaniment: { title: 'Accompagnement', detail: 'Musique sans voix', icon: 'wave' },
  drums: { title: 'Batterie & kicks', detail: 'Batterie, percussions et kicks', icon: 'drum' },
  bass: { title: 'Basse', detail: 'Bassline extraite', icon: 'bass' },
  other: { title: 'Instruments', detail: 'Autres instruments et nappes', icon: 'spark' },
};
function icon(name) {
  const paths = { mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0012 0M12 17v4M9 21h6"/>', wave: '<path d="M3 12h3l2-6 4 12 3-8 2 2h4"/>', drum: '<ellipse cx="12" cy="16" rx="7" ry="4"/><path d="M5 10v6M19 10v6M5 10c0-2 14-2 14 0M8 6l2 4m4-4-2 4"/>', bass: '<path d="M7 3v18M7 5h6l4 4-4 4H7M7 13h6l4 4-4 4H7"/>', spark: '<path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3z"/>' };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}
function speakerIcon(muted = false) { return muted ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10v4h4l5 4V6l-5 4H5zM17 10l4 4m0-4-4 4"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10v4h4l5 4V6l-5 4H5zM17 9a4 4 0 010 6"/></svg>'; }
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
function closeFxModal() {
  const modal = $('#fxModal');
  if (modal.getAttribute('aria-hidden') === 'true') return;
  modal.classList.remove('is-open');
  fxCloseTimer = setTimeout(() => modal.setAttribute('aria-hidden', 'true'), 240);
}
function openFxModal(name) {
  const info = stemInfo[name], modal = $('#fxModal');
  clearTimeout(fxCloseTimer);
  $('#fxModalTitle').textContent = `Fx — ${info.title}`;
  const targetInfo = stemInfo[saturationTarget], content = $('#fxModalContent');
  if (name === saturationTarget) {
    const value = saturationByTrack[name] || 0;
    content.innerHTML = `<div class="fx-effect-card"><div class="fx-effect-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15c2-7 4 7 6 0s4-7 6 0 3 0 4-3"/></svg></div><div><p class="eyebrow">EFFET DISPONIBLE</p><h3>Saturation basse</h3><p>Ajoute du grain aux graves sans devoir monter le volume.</p></div></div><label class="fx-intensity">Intensité <output id="saturationOut">${value}%</output><input id="saturationInput" type="range" min="0" max="100" value="${value}" aria-label="Intensité de la saturation basse"></label>`;
    $('#saturationInput').oninput = event => { saturationByTrack[name] = +event.currentTarget.value; $('#saturationOut').textContent = `${event.currentTarget.value}%`; updateLiveMix(); };
  } else {
    content.innerHTML = `<div class="fx-empty-state"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/></svg><h3>Aucun effet sur cette piste</h3><p>La saturation basse est disponible uniquement sur <span>${targetInfo.title.toLowerCase()}</span> pour cette séparation.</p></div>`;
  }
  modal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => modal.classList.add('is-open'));
  modal.querySelector('.fx-close').focus();
}
function bindFxModal() {
  document.querySelectorAll('[data-fx]').forEach(button => button.onclick = () => openFxModal(button.dataset.fx));
  document.querySelectorAll('[data-fx-close]').forEach(button => button.onclick = closeFxModal);
}
function closeChangelog() {
  const modal = $('#changelogModal');
  if (modal.getAttribute('aria-hidden') === 'true') return;
  modal.classList.remove('is-open');
  changelogCloseTimer = setTimeout(() => modal.setAttribute('aria-hidden', 'true'), 240);
  $('#versionButton').focus();
}
function openChangelog() {
  const modal = $('#changelogModal');
  clearTimeout(changelogCloseTimer);
  modal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => modal.classList.add('is-open'));
  modal.querySelector('.changelog-close').focus();
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
  updatePlayheads(Math.max(0, audioCtx.currentTime - playStartedAt));
  playheadFrame = requestAnimationFrame(animatePlayheads);
}
function renderTracks(names) {
  saturationTarget = names.includes('bass') ? 'bass' : 'accompaniment';
  $('#tracks').innerHTML = names.map(name => { const info = stemInfo[name], automation = `<div class="automation-tools"><span>Pan ${info.title.toLowerCase()}</span><span class="automation-time" data-automation-time="${name}">0:00</span><button type="button" data-automation-pan="${name}" data-pan="-100">Gauche</button><button type="button" data-automation-pan="${name}" data-pan="0">Centre</button><button type="button" data-automation-pan="${name}" data-pan="100">Droite</button><button type="button" class="remove-point" data-automation-remove="${name}" title="Supprimer le point sélectionné">×</button></div>`; return `<article class="track ${name}"><div class="track-icon">${icon(info.icon)}</div><div class="track-title"><h3>${info.title}</h3><p>${info.detail}</p></div><button type="button" class="fx-button" data-fx="${name}" title="Ouvrir les effets de ${info.title}">Fx</button><div class="pan-fader" title="Panoramique"><span class="pan-letter">L</span><div class="gauge pan-gauge"><i></i><input aria-label="Panoramique : ${info.title}" data-control="${name}" data-param="pan" type="range" min="-100" max="100" value="0"></div><output id="${name}PanOut">0</output><span class="pan-letter">R</span></div><div class="wave-area"><canvas class="waveform" data-waveform="${name}" aria-label="Forme d'onde : ${info.title}"></canvas><span class="playhead" data-playhead="${name}" aria-hidden="true"></span>${automation}</div><div class="volume-stack"><button class="mute" data-mute="${name}" aria-pressed="false" title="Couper ${info.title}">${speakerIcon()}</button><div class="volume-fader" title="Volume"><div class="gauge volume-gauge"><i></i><input aria-label="Volume : ${info.title}" data-control="${name}" data-param="volume" type="range" min="0" max="150" value="100"></div><output id="${name}VolumeOut">100</output></div></div></article>`; }).join('');
  document.querySelectorAll('[data-control]').forEach(el => el.oninput = updateOutputs);
  document.querySelectorAll('[data-mute]').forEach(button => button.onclick = () => { const muted = button.getAttribute('aria-pressed') === 'true'; button.setAttribute('aria-pressed', String(!muted)); button.innerHTML = speakerIcon(!muted); updateLiveMix(); });
  bindAutomation();
  bindFxModal();
  updateOutputs();
}
function stop() { if (playheadFrame) cancelAnimationFrame(playheadFrame); playheadFrame = undefined; liveNodes.forEach(({ source }) => { try { source.stop(); } catch {} }); liveNodes = new Map(); playing = false; updatePlayheads(); $('#playButton').disabled = false; $('#stopButton').disabled = true; }
function playMix() {
  stop(); audioCtx ??= new AudioContext(); playStartedAt = audioCtx.currentTime;
  for (const [name, buffer] of Object.entries(tracks)) {
    const source = audioCtx.createBufferSource(), cfg = settings(name), nodes = createTrackNodes(audioCtx, source, name, cfg, audioCtx.destination);
    source.buffer = buffer; schedulePan(nodes.panner, name, cfg, playStartedAt);
    source.onended = () => { if (playing) stop(); }; source.start(); liveNodes.set(name, { source, ...nodes });
  }
  playing = true; updatePlayheads(); playheadFrame = requestAnimationFrame(animatePlayheads); $('#playButton').disabled = true; $('#stopButton').disabled = false;
}
function wavBlob(buffer) {
  const channels = buffer.numberOfChannels, length = buffer.length * channels * 2, out = new ArrayBuffer(44 + length), view = new DataView(out);
  const write = (offset, str) => [...str].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0,'RIFF'); view.setUint32(4,36+length,true); write(8,'WAVE'); write(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,channels,true); view.setUint32(24,buffer.sampleRate,true); view.setUint32(28,buffer.sampleRate*channels*2,true); view.setUint16(32,channels*2,true); view.setUint16(34,16,true); write(36,'data'); view.setUint32(40,length,true);
  let at=44; for(let i=0;i<buffer.length;i++) for(let ch=0;ch<channels;ch++){let s=Math.max(-1,Math.min(1,buffer.getChannelData(ch)[i]));view.setInt16(at,s<0?s*0x8000:s*0x7fff,true);at+=2;} return new Blob([out],{type:'audio/wav'});
}
async function exportMix() {
  stop(); const duration = Math.max(...Object.values(tracks).map(b => b.duration)), rate = tracks.vocals.sampleRate;
  const offline = new OfflineAudioContext(2, Math.ceil(duration * rate), rate);
  for (const [name, buffer] of Object.entries(tracks)) { const source=offline.createBufferSource(),cfg=settings(name),nodes=createTrackNodes(offline,source,name,cfg,offline.destination); source.buffer=buffer;schedulePan(nodes.panner,name,cfg,0);source.start(); }
  status('Rendu stéréo en cours…'); const rendered=await offline.startRendering(), url=URL.createObjectURL(wavBlob(rendered)), link=document.createElement('a');link.href=url;link.download='audiosplit-mix-stereo.wav';link.click();URL.revokeObjectURL(url);status('Mixage WAV stéréo exporté.');
}
$('#chooseButton').onclick=()=>$('#fileInput').click();
$('#fileInput').onchange=(e)=>{const f=e.target.files[0];$('#fileName').textContent=f?f.name:'';$('#separateButton').disabled=!f;status('');};
$('#separateButton').onclick=async()=>{const file=$('#fileInput').files[0],button=$('#separateButton'),mode=document.querySelector('input[name="splitMode"]:checked').value,engine=document.querySelector('input[name="engine"]:checked').value;button.disabled=true;status(engine==='fast'?'Séparation rapide en cours…':'Séparation studio en cours — comptez quelques minutes…');const form=new FormData();form.append('file',file);form.append('mode',mode);form.append('engine',engine);try{const res=await fetch('/api/separate',{method:'POST',body:form}),data=await res.json();if(!res.ok)throw Error(data.detail||'Erreur de séparation');audioCtx ??= new AudioContext();const names=Object.keys(data.stems);renderTracks(names);const decoded=await Promise.all(names.map(async name=>[name,await fetch(data.stems[name]).then(r=>r.arrayBuffer()).then(b=>audioCtx.decodeAudioData(b))]));Object.keys(tracks).forEach(name=>delete tracks[name]);decoded.forEach(([name,buffer])=>{tracks[name]=buffer;ensureAutomation(name,buffer.duration);});$('#mixer').classList.remove('hidden');requestAnimationFrame(()=>{decoded.forEach(([name,buffer])=>drawWaveform(name,buffer));names.forEach(refreshAutomation);});$('#playButton').disabled=false;$('#exportButton').disabled=false;status(data.cacheHit?'Résultat chargé instantanément depuis le cache local.':'Séparation terminée. Glissez les points de n’importe quelle courbe pour automatiser son panoramique.');}catch(err){status(err.message,true);button.disabled=false;}};
$('#playButton').onclick=playMix;$('#stopButton').onclick=stop;$('#exportButton').onclick=exportMix;
$('#versionButton').onclick=openChangelog;
document.querySelectorAll('[data-changelog-close]').forEach(button => button.onclick=closeChangelog);
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeFxModal(); closeChangelog(); } });
window.addEventListener('resize',()=>Object.entries(tracks).forEach(([name, buffer])=>buffer&&drawWaveform(name,buffer)));
