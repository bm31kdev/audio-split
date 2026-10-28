const $ = (sel) => document.querySelector(sel);
const tracks = {};
let audioCtx, liveNodes = new Map(), playing = false;

function status(message, error = false) {
  const target = $('#status'); target.textContent = message; target.style.color = error ? '#ff987f' : '';
}
function settings(name) {
  const volume = +document.querySelector(`[data-control="${name}"][data-param="volume"]`).value / 100;
  const pan = +document.querySelector(`[data-control="${name}"][data-param="pan"]`).value / 100;
  return { volume, pan, muted: document.querySelector(`[data-mute="${name}"]`).getAttribute('aria-pressed') === 'true' };
}
function updateLiveMix() {
  if (!audioCtx || !playing) return;
  for (const [name, nodes] of liveNodes) {
    const cfg = settings(name), now = audioCtx.currentTime;
    nodes.gain.gain.setTargetAtTime(cfg.muted ? 0 : cfg.volume, now, 0.012);
    nodes.panner.pan.setTargetAtTime(cfg.pan, now, 0.012);
  }
}
function updateOutputs() {
  document.querySelectorAll('[data-control]').forEach(input => {
    const name = input.dataset.control, param = input.dataset.param, value = +input.value;
    const output = $(`#${name}${param === 'volume' ? 'Volume' : 'Pan'}Out`);
    output.textContent = param === 'volume' ? `${value}%` : value === 0 ? 'Centre' : `${Math.abs(value)}% ${value < 0 ? 'G' : 'D'}`;
  });
  updateLiveMix();
}
function drawWaveform(name, buffer) {
  const canvas = document.querySelector(`[data-waveform="${name}"]`), ratio = devicePixelRatio || 1;
  const width = Math.max(120, canvas.clientWidth), height = Math.max(40, canvas.clientHeight);
  canvas.width = width * ratio; canvas.height = height * ratio;
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, height);
  const data = buffer.getChannelData(0), step = Math.max(1, Math.floor(data.length / width));
  ctx.strokeStyle = name === 'vocals' ? '#f2a9e1' : '#8cdbff'; ctx.globalAlpha = .9; ctx.lineWidth = 1;
  ctx.beginPath(); for (let x = 0; x < width; x++) { let min = 1, max = -1; const start = x * step; for (let i = 0; i < step && start + i < data.length; i++) { const value = data[start + i]; if (value < min) min = value; if (value > max) max = value; } const y1 = (1 + min) * height / 2, y2 = (1 + max) * height / 2; ctx.moveTo(x, y1); ctx.lineTo(x, y2); } ctx.stroke();
}
const stemInfo = {
  vocals: { title: 'Voix', detail: 'Stem vocal extrait', icon: '♫' },
  accompaniment: { title: 'Accompagnement', detail: 'Musique sans voix', icon: '≋' },
  drums: { title: 'Batterie & kicks', detail: 'Batterie, percussions et kicks', icon: '◉' },
  bass: { title: 'Basse', detail: 'Bassline extraite', icon: '⌁' },
  other: { title: 'Instruments', detail: 'Autres instruments et nappes', icon: '✦' },
};
function renderTracks(names) {
  $('#tracks').innerHTML = names.map(name => { const info = stemInfo[name]; return `<article class="track ${name}"><div class="track-icon">${info.icon}</div><div class="track-title"><h3>${info.title}</h3><p>${info.detail}</p></div><button class="mute" data-mute="${name}" aria-pressed="false" title="Couper ${info.title}">🔊</button><canvas class="waveform" data-waveform="${name}" aria-label="Forme d'onde : ${info.title}"></canvas><div class="control"><label>Volume <output id="${name}VolumeOut">100%</output></label><input data-control="${name}" data-param="volume" type="range" min="0" max="150" value="100"></div><div class="pan-control"><span class="pan-label top">G</span><input aria-label="Panoramique : ${info.title}" data-control="${name}" data-param="pan" class="vertical-pan" type="range" min="-100" max="100" value="0"><span class="pan-label bottom">D</span><output id="${name}PanOut">Centre</output></div></article>`; }).join('');
  document.querySelectorAll('[data-control]').forEach(el => el.oninput = updateOutputs);
  document.querySelectorAll('[data-mute]').forEach(button => button.onclick = () => { const muted = button.getAttribute('aria-pressed') === 'true'; button.setAttribute('aria-pressed', String(!muted)); button.textContent = muted ? '🔊' : '🔇'; updateLiveMix(); });
  updateOutputs();
}
function stop() { liveNodes.forEach(({ source }) => { try { source.stop(); } catch {} }); liveNodes = new Map(); playing = false; $('#playButton').disabled = false; $('#stopButton').disabled = true; }
function playMix() {
  stop(); audioCtx ??= new AudioContext();
  for (const [name, buffer] of Object.entries(tracks)) {
    const source = audioCtx.createBufferSource(), gain = audioCtx.createGain(), panner = audioCtx.createStereoPanner(), cfg = settings(name);
    source.buffer = buffer; gain.gain.value = cfg.muted ? 0 : cfg.volume; panner.pan.value = cfg.pan;
    source.connect(gain).connect(panner).connect(audioCtx.destination); source.onended = () => { if (playing) stop(); }; source.start(); liveNodes.set(name, { source, gain, panner });
  }
  playing = true; $('#playButton').disabled = true; $('#stopButton').disabled = false;
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
  for (const [name, buffer] of Object.entries(tracks)) { const source=offline.createBufferSource(),gain=offline.createGain(),panner=offline.createStereoPanner(),cfg=settings(name); source.buffer=buffer;gain.gain.value=cfg.muted?0:cfg.volume;panner.pan.value=cfg.pan;source.connect(gain).connect(panner).connect(offline.destination);source.start(); }
  status('Rendu stéréo en cours…'); const rendered=await offline.startRendering(), url=URL.createObjectURL(wavBlob(rendered)), link=document.createElement('a');link.href=url;link.download='audiosplit-mix-stereo.wav';link.click();URL.revokeObjectURL(url);status('Mixage WAV stéréo exporté.');
}
$('#chooseButton').onclick=()=>$('#fileInput').click();
$('#fileInput').onchange=(e)=>{const f=e.target.files[0];$('#fileName').textContent=f?f.name:'';$('#separateButton').disabled=!f;status('');};
$('#separateButton').onclick=async()=>{const file=$('#fileInput').files[0],button=$('#separateButton'),mode=document.querySelector('input[name="splitMode"]:checked').value;button.disabled=true;status(mode==='detailed'?'Séparation détaillée en cours — comptez quelques minutes…':'Séparation en cours — cela peut prendre plusieurs minutes…');const form=new FormData();form.append('file',file);form.append('mode',mode);try{const res=await fetch('/api/separate',{method:'POST',body:form}),data=await res.json();if(!res.ok)throw Error(data.detail||'Erreur de séparation');audioCtx ??= new AudioContext();const names=Object.keys(data.stems);renderTracks(names);const decoded=await Promise.all(names.map(async name=>[name,await fetch(data.stems[name]).then(r=>r.arrayBuffer()).then(b=>audioCtx.decodeAudioData(b))]));Object.keys(tracks).forEach(name=>delete tracks[name]);decoded.forEach(([name,buffer])=>{tracks[name]=buffer;drawWaveform(name,buffer);});$('#mixer').classList.remove('hidden');status('Séparation terminée. Réglez vos pistes ci-dessous.');}catch(err){status(err.message,true);button.disabled=false;}};
$('#playButton').onclick=playMix;$('#stopButton').onclick=stop;$('#exportButton').onclick=exportMix;
window.addEventListener('resize',()=>Object.entries(tracks).forEach(([name, buffer])=>buffer&&drawWaveform(name,buffer)));
