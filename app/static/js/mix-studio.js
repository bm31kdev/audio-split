// The Mix workspace is an independent two-deck stereo editor.
// Source projects are flattened in the browser so a saved mix does not depend
// on the source project still being present in the library.
import { createTrackNodes, effectDefaults, getSaturationTarget, getWidthTarget, setTrackTargets, updateTrackEffects } from './audio-engine.js?v=1.5.0.49';
import { scheduleOfflineDeEsser } from './effects/de-esser.js?v=1.5.0.18';
import { scheduleOfflineNoiseGate } from './effects/noise-gate.js?v=1.5.0.18';
import { scheduleOfflineVoiceDucking } from './effects/voice-ducking.js?v=1.5.0.18';
import { closeStyledDropdowns } from './styled-dropdowns.js?v=1.5.0.26';
const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function createMixStudio({ apiJson, getLibrary, refreshLibrary, status, language }) {
  const page = $('#mixPage');
  const decks = { a: null, b: null };
  const context = new AudioContext();
  const liveMaster = context.createDynamicsCompressor();
  liveMaster.threshold.value = -2; liveMaster.knee.value = 3; liveMaster.ratio.value = 10; liveMaster.attack.value = .004; liveMaster.release.value = .18;
  liveMaster.connect(context.destination);
  let pickTarget = null, pickerOpener = null, loadingDeck = false, activeMixId = null, offset = 0, startedAt = 0, raf = 0, sources = [], paused = true;
  let mixFolderId = null;

  const label = (fr, en) => language() === 'en' ? en : fr;
  const readTransition = () => ({
    style: $('#mixTransitionStyle').value,
    duration: Number($('#mixTransitionDuration').value) || 8,
  });
  const overlap = () => Math.min(readTransition().duration, decks.a?.duration || 0, decks.b?.duration || 0);
  const totalDuration = () => decks.a && decks.b ? decks.a.duration + decks.b.duration - overlap() : 0;
  const fmt = seconds => {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  };

  function draw(deck) {
    const canvas = $(`[data-mix-wave="${deck}"]`, page), audio = decks[deck]?.buffer || null;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
    // The picker may finish decoding during a page transition. Wait until the
    // deck is visible so the canvas gets its real layout dimensions.
    if (rect.width <= 1 || rect.height <= 1) return;
    canvas.width = Math.max(1, Math.round(rect.width * ratio)); canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = '#181b21'; ctx.fillRect(0, 0, rect.width, rect.height);
    if (!audio) return;
    const data = audio.getChannelData(0), width = Math.ceil(rect.width);
    const mid = rect.height / 2, color = deck === 'a' ? '#d7ff54' : '#73c9ff';
    const upper = new Float32Array(width), lower = new Float32Array(width);
    for (let x = 0; x < width; x += 1) {
      const start = Math.floor(x * data.length / width), end = Math.max(start + 1, Math.floor((x + 1) * data.length / width));
      let min = 1, max = -1;
      for (let i = start; i < end && i < data.length; i += 1) { const sample = data[i]; min = Math.min(min, sample); max = Math.max(max, sample); }
      upper[x] = mid - max * (mid - 5); lower[x] = mid - min * (mid - 5);
    }
    const envelope = new Path2D(); envelope.moveTo(0, upper[0] ?? mid);
    for (let x = 0; x < width; x += 1) envelope.lineTo(x + .5, upper[x]);
    for (let x = width - 1; x >= 0; x -= 1) envelope.lineTo(x + .5, lower[x]);
    envelope.closePath();
    const glow = ctx.createLinearGradient(0, 8, 0, rect.height - 8);
    glow.addColorStop(0, `${color}55`); glow.addColorStop(.5, `${color}bb`); glow.addColorStop(1, `${color}55`);
    ctx.fillStyle = glow; ctx.fill(envelope);
    ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 8; ctx.strokeStyle = `${color}dd`; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < width; x += 1) ctx.lineTo(x + .5, upper[x]);
    for (let x = width - 1; x >= 0; x -= 1) ctx.lineTo(x + .5, lower[x]);
    ctx.stroke(); ctx.restore();
    ctx.strokeStyle = '#ffffff16'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, mid + .5); ctx.lineTo(rect.width, mid + .5); ctx.stroke();
    const crossfadeStart = Math.max(0, audio.duration - overlap());
    if (deck === 'a' && decks.b) {
      const x = rect.width * crossfadeStart / audio.duration;
      ctx.fillStyle = '#d7ff5422'; ctx.fillRect(x, 0, rect.width - x, rect.height);
      ctx.strokeStyle = '#d7ff54'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rect.height); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  function updateDeckCard(which) {
    const audio = decks[which], card = $(`[data-mix-deck="${which}"]`, page);
    card.classList.toggle('has-audio', Boolean(audio));
    $(`[data-mix-empty="${which}"]`, card).classList.toggle('hidden', Boolean(audio));
    $(`[data-mix-loaded="${which}"]`, card).classList.toggle('hidden', !audio);
    if (audio) {
      $(`[data-mix-name="${which}"]`, card).textContent = audio.name;
      $(`[data-mix-duration="${which}"]`, card).textContent = fmt(audio.duration);
      $(`[data-mix-bpm="${which}"]`, card).textContent = audio.bpm ? `${Number(audio.bpm).toFixed(1)} BPM` : '— BPM';
      $(`[data-mix-key="${which}"]`, card).textContent = audio.key || '—';
    }
    draw(which); updateControls();
    // Repaint after the empty placeholder has been removed and the canvas has
    // received its final width from the browser's layout pass.
    requestAnimationFrame(() => draw(which));
  }

  function updateControls() {
    const ready = Boolean(decks.a && decks.b);
    $('#mixPlayButton').disabled = !ready; $('#mixStopButton').disabled = !ready;
    $('#mixExportButton').disabled = !ready; $('#mixSaveButton').disabled = !ready;
    $('#mixTimeline').disabled = !ready;
    $('#mixTimeline').max = String(Math.max(1, totalDuration()));
    $('#mixTimelineEnd').textContent = fmt(totalDuration());
    $('#mixPlayButton').textContent = paused ? label('Lecture', 'Play') : label('Pause', 'Pause');
    $('#mixSaveStatus').textContent = activeMixId ? label('Mixage enregistré', 'Mix saved') : '';
  }

  function stopAudio(reset = true) {
    cancelAnimationFrame(raf); sources.forEach(source => { try { source.stop(); } catch {} }); sources = [];
    paused = true; if (reset) offset = 0; updateControls();
  }
  function makeDeckNodes(audio, target, base, position, mode) {
    const source = target.createBufferSource(), gain = target.createGain();
    const filter = target.createBiquadFilter(); source.buffer = audio;
    filter.type = 'lowpass'; filter.frequency.value = 22000; filter.Q.value = .7;
    source.connect(filter); filter.connect(gain); gain.connect(target === context ? liveMaster : target.destination);
    let shelf = null;
    if (readTransition().style === 'eq') {
      shelf = target.createBiquadFilter(); shelf.type = 'lowshelf'; shelf.frequency.value = 180;
      filter.disconnect(); filter.connect(shelf); shelf.connect(gain);
    }
    const overlapSeconds = overlap(), start = decks.a.duration - overlapSeconds, end = start + overlapSeconds;
    const now = target.currentTime, currentMixPosition = position;
    const progress = Math.max(0, Math.min(1, (currentMixPosition - start) / Math.max(.001, overlapSeconds)));
    if (mode === 'a') {
      const gainParam = gain.gain; gainParam.setValueAtTime(currentMixPosition >= start ? 1 - progress : 1, now);
      if (currentMixPosition < end) {
        const fadeAt = Math.max(now, now + start - currentMixPosition);
        const fadeDuration = Math.max(.001, end - Math.max(start, currentMixPosition));
        if (currentMixPosition < start) gainParam.setValueAtTime(1, fadeAt);
        if (readTransition().style === 'filter') {
          filter.frequency.setValueAtTime(currentMixPosition >= start ? 22000 - 21550 * progress : 22000, now);
          filter.frequency.setValueAtTime(currentMixPosition >= start ? 22000 - 21550 * progress : 22000, fadeAt);
          filter.frequency.linearRampToValueAtTime(450, fadeAt + fadeDuration);
        }
        if (shelf) { shelf.gain.setValueAtTime(-7 * progress, now); shelf.gain.setValueAtTime(0, fadeAt); shelf.gain.linearRampToValueAtTime(-7, fadeAt + fadeDuration); }
        gainParam.linearRampToValueAtTime(0, fadeAt + fadeDuration);
      }
      source.start(base, Math.max(0, currentMixPosition));
    } else {
      const deckStart = start, localPosition = Math.max(0, currentMixPosition - deckStart);
      gain.gain.setValueAtTime(currentMixPosition >= deckStart ? progress : 0, now);
      const beginAt = Math.max(now, now + deckStart - currentMixPosition);
      const fadeDuration = Math.max(.001, end - Math.max(deckStart, currentMixPosition));
      if (readTransition().style === 'filter') {
        const initialFrequency = currentMixPosition >= deckStart ? 450 + 21550 * progress : 450;
        filter.frequency.setValueAtTime(initialFrequency, now);
        if (currentMixPosition < deckStart) filter.frequency.setValueAtTime(initialFrequency, beginAt);
        filter.frequency.linearRampToValueAtTime(22000, beginAt + fadeDuration);
      }
      if (shelf) { shelf.gain.setValueAtTime(currentMixPosition >= deckStart ? -7 + 7 * progress : -7, now); if (currentMixPosition < deckStart) shelf.gain.setValueAtTime(-7, beginAt); shelf.gain.linearRampToValueAtTime(0, beginAt + fadeDuration); }
      if (currentMixPosition < deckStart) gain.gain.setValueAtTime(0, beginAt);
      gain.gain.linearRampToValueAtTime(1, beginAt + fadeDuration);
      source.start(beginAt, localPosition);
    }
    return { source, gain, filter };
  }

  function animate() {
    if (paused) return;
    offset = Math.min(totalDuration(), (performance.now() - startedAt) / 1000);
    $('#mixTimeline').value = String(offset); $('#mixTimelineNow').textContent = fmt(offset);
    if (offset >= totalDuration()) { stopAudio(false); offset = totalDuration(); $('#mixTimeline').value = String(offset); $('#mixTimelineNow').textContent = fmt(offset); return; }
    raf = requestAnimationFrame(animate);
  }

  async function startPlayback(position = offset) {
    if (!decks.a || !decks.b) return;
    stopAudio(false); offset = Math.max(0, Math.min(totalDuration(), position));
    await context.resume();
    const base = context.currentTime + .05;
    for (const [which, mode] of [['a', 'a'], ['b', 'b']]) {
      if (which === 'a' && offset >= decks.a.duration) continue;
      if (which === 'b' && offset >= totalDuration()) continue;
      const audio = decks[which], nodes = makeDeckNodes(audio, context, base, offset, mode);
      sources.push(nodes.source);
    }
    paused = false; startedAt = performance.now() - offset * 1000; updateControls(); animate();
  }

  async function flattenProject(projectId) {
    const project = await apiJson(`/api/library/projects/${projectId}`);
    const decodedEstimate = Object.values(project.stemDecodedBytes || {}).reduce((sum, bytes) => sum + Number(bytes || 0), 0);
    if (decodedEstimate > 512 * 1024 * 1024) throw new Error(label('Ce projet est trop volumineux pour être réduit en stéréo sur cette machine.', 'This project is too large to flatten to stereo on this machine.'));
    const transform = project.transform || {}, ratio = Number(transform.tempoRatio) || 1;
    let stems = project.stems.map(name => [name, project.audio[name]]);
    if (ratio !== 1 || Number(transform.pitchSemitones || 0) !== 0) {
      status(label('Application des réglages tempo et tonalité du projet…', 'Applying the project tempo and pitch settings…'));
      const rendered = await apiJson('/api/transforms', { method: 'POST', body: JSON.stringify({
        projectId: project.id, tempoRatio: ratio, pitchSemitones: Number(transform.pitchSemitones) || 0,
        pitchTargets: transform.pitchTrack ? [transform.pitchTrack] : [], language: language(),
      }) });
      stems = project.stems.map(name => [name, rendered.stems[name]]);
    }
    const decoded = [];
    for (const [name, url] of stems) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(label('Impossible de charger une piste du projet.', 'Could not load a project stem.'));
      decoded.push([name, await context.decodeAudioData(await response.arrayBuffer())]);
    }
    const duration = Math.max(...decoded.map(([, buffer]) => buffer.duration));
    const rate = decoded[0][1].sampleRate;
    if (duration * rate * 8 > 768 * 1024 * 1024) throw new Error(label('Le rendu stéréo de ce projet dépasserait la mémoire disponible.', 'Rendering this project to stereo would exceed the available memory limit.'));
    const offline = new OfflineAudioContext(2, Math.ceil(duration * rate), rate);
    const limiter = offline.createDynamicsCompressor(); limiter.threshold.value = -2; limiter.knee.value = 3; limiter.ratio.value = 10; limiter.connect(offline.destination);
    const previousSaturationTarget = getSaturationTarget(), previousWidthTarget = getWidthTarget();
    setTrackTargets(project.stems.includes('bass'), project.stems.includes('other'));
    const hasSolo = project.stems.some(name => project.settings?.[name]?.solo);
    const renderedNodes = new Map();
    for (const [name, buffer] of decoded) {
      const config = project.settings?.[name] || {};
      const effects = { ...effectDefaults, ...(project.effects?.[name] || {}) };
      const source = offline.createBufferSource(); source.buffer = buffer;
      const nodes = createTrackNodes(offline, source, name, { muted: Boolean(config.muted || (hasSolo && !config.solo)), volume: Math.max(0, Math.min(1.5, Number(config.volume ?? 100) / 100)), pan: Math.max(-1, Math.min(1, Number(config.pan || 0) / 100)), effects }, limiter);
      const panPoints = [...(project.automation?.[name]?.points || [])].sort((a, b) => a.time - b.time);
      if (panPoints.length) {
        nodes.panner.pan.setValueAtTime(Math.max(-1, Math.min(1, Number(panPoints[0].pan || 0) / 100 + Number(config.pan || 0) / 100)), 0);
        for (const point of panPoints.slice(1)) nodes.panner.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, Number(point.pan || 0) / 100 + Number(config.pan || 0) / 100)), Math.min(buffer.duration, Math.max(0, Number(point.time) || 0)));
      } else nodes.panner.pan.value = Number(config.pan || 0) / 100;
      const volumePoints = project.automation?.[name]?.lanes?.volume || [];
      if (volumePoints.length) {
        const count = Math.min(120001, Math.max(2, Math.ceil(buffer.duration * 60) + 1)), curve = new Float32Array(count), ordered = [...volumePoints].sort((a, b) => a.time - b.time);
        for (let index = 0; index < count; index += 1) {
          const time = buffer.duration * index / (count - 1); let value = Number(config.volume ?? 100);
          if (time <= ordered[0].time) value = ordered[0].value;
          else if (time >= ordered.at(-1).time) value = ordered.at(-1).value;
          else { const right = ordered.findIndex(point => point.time >= time), leftPoint = ordered[right - 1], rightPoint = ordered[right], progress = (time - leftPoint.time) / Math.max(.001, rightPoint.time - leftPoint.time); value = leftPoint.value + (rightPoint.value - leftPoint.value) * progress; }
          curve[index] = config.muted ? 0 : Math.max(0, Math.min(1.5, Number(value) / 100));
        }
        nodes.gain.gain.cancelScheduledValues(0); nodes.gain.gain.setValueCurveAtTime(curve, 0, buffer.duration);
      }
      const lanes = project.automation?.[name]?.lanes || {};
      const keyframeTimes = [...new Set(Object.entries(lanes).filter(([key]) => key !== 'volume').flatMap(([, points]) => points.map(point => Math.max(0, Math.min(buffer.duration, Number(point.time) || 0)))))].sort((a, b) => a - b);
      for (const time of keyframeTimes) {
        const values = { ...effects };
        for (const [key, points] of Object.entries(lanes)) {
          if (key === 'volume' || !points.length) continue;
          const ordered = [...points].sort((a, b) => a.time - b.time);
          if (time <= ordered[0].time) values[key] = ordered[0].value;
          else if (time >= ordered.at(-1).time) values[key] = ordered.at(-1).value;
          else { const right = ordered.findIndex(point => point.time >= time), leftPoint = ordered[right - 1], rightPoint = ordered[right], progress = (time - leftPoint.time) / Math.max(.001, rightPoint.time - leftPoint.time); values[key] = leftPoint.value + (rightPoint.value - leftPoint.value) * progress; }
        }
        updateTrackEffects(nodes, values, { currentTime: time }, 0);
      }
      source.start(); renderedNodes.set(name, nodes);
    }
    setTrackTargets(previousSaturationTarget === 'bass', previousWidthTarget === 'other');
    const vocalBuffer = decoded.find(([name]) => name === 'vocals')?.[1];
    if (vocalBuffer) for (const [name, nodes] of renderedNodes) {
      if (nodes.effects.ducking) scheduleOfflineVoiceDucking(nodes.effects.ducking, vocalBuffer, project.effects?.[name]?.ducking || 0, offline, project.settings?.vocals?.muted ? 0 : Math.max(0, Number(project.settings?.vocals?.volume ?? 100) / 100));
    }
    for (const [name, nodes] of renderedNodes) {
      if (nodes.effects.gate) scheduleOfflineNoiseGate(nodes.effects.gate, decoded.find(([stem]) => stem === name)[1], project.effects?.[name]?.gate || 0, offline);
      if (nodes.effects.deEsser) scheduleOfflineDeEsser(nodes.effects.deEsser, decoded.find(([stem]) => stem === name)[1], project.effects?.[name]?.deEsser || 0);
    }
    const audio = await offline.startRendering();
    return {
      buffer: audio,
      name: project.name || project.sourceName || label('Projet', 'Project'),
      projectId: project.id, sourceName: project.sourceName || project.name,
      bpm: transform.targetBpm || transform.sourceBpm || null,
      key: transform.targetKey || transform.sourceKey || null,
      duration: audio.duration,
    };
  }

  function renderPicker() {
    const library = getLibrary(), projects = (library.folders || []).flatMap(folder => (folder.projects || []).map(project => ({ ...project, folderName: folder.name })));
    const targetDeck = pickTarget;
    const targetName = pickTarget === 'a' ? label('Piste 1', 'Deck 1') : label('Piste 2', 'Deck 2');
    $('#mixPickerTitle').textContent = label(`Choisir un projet pour ${targetName}`, `Choose a project for ${targetName}`);
    $('#mixPickerList').innerHTML = projects.length ? projects.map(project => `<button class="mix-picker-item" type="button" data-pick-project="${project.id}"><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.folderName)} · ${escapeHtml(project.sourceName || '')}</span><small>${escapeHtml(project.mode === 'detailed' ? label('Séparation détaillée', 'Detailed stems') : label('Voix + accompagnement', 'Vocals + accompaniment'))}</small></button>`).join('') : `<p class="mix-empty">${label('Aucun projet enregistré. Enregistrez d’abord une séparation dans Projets.', 'No saved projects. Save a separation in Projects first.')}</p>`;
    closeStyledDropdowns();
    const modal = $('#mixPickerModal'); modal.hidden = false; modal.inert = false; modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open'); requestAnimationFrame(() => modal.classList.add('is-open'));
    $('#mixPickerList').querySelectorAll('[data-pick-project]').forEach(button => button.onclick = async () => {
      if (loadingDeck) return;
      loadingDeck = true; button.disabled = true; button.setAttribute('aria-busy', 'true');
      closePicker(); status(label('Création de la piste stéréo…', 'Building the stereo deck…'), false, true);
      try {
        const result = await flattenProject(button.dataset.pickProject);
        decks[targetDeck] = result; activeMixId = null; updateDeckCard(targetDeck);
        status(label('Piste ajoutée au Mix.', 'Deck added to Mix.'));
      } catch (error) {
        console.error('Could not add a project to the Mix deck.', error);
        status(error.message || label('Impossible de créer la piste stéréo.', 'Could not build the stereo deck.'), true);
      } finally { loadingDeck = false; status('', false, true); }
    });
  }

  function closePicker() {
    const modal = $('#mixPickerModal');
    pickerOpener?.focus({ preventScroll: true });
    modal.inert = true; modal.setAttribute('aria-hidden', 'true'); modal.classList.remove('is-open');
    document.body.classList.remove('modal-open');
    setTimeout(() => { modal.hidden = true; }, 240);
  }

  function encodeWav(buffer) {
    const frames = buffer.length, channels = 2, dataBytes = frames * channels * 2, out = new ArrayBuffer(44 + dataBytes), view = new DataView(out);
    const write = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    write(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, dataBytes, true);
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1); let cursor = 44;
    for (let index = 0; index < frames; index += 1) for (const sample of [left[index], right[index]]) { const clipped = Math.max(-1, Math.min(1, sample)); view.setInt16(cursor, clipped < 0 ? clipped * 32768 : clipped * 32767, true); cursor += 2; }
    return new Blob([out], { type: 'audio/wav' });
  }

  async function renderFullMix() {
    const duration = totalDuration(), rate = Math.max(decks.a.buffer.sampleRate, decks.b.buffer.sampleRate);
    if (duration <= 0 || duration * rate * 8 > 1_500_000_000) throw new Error(label('Mix trop long pour être rendu en mémoire sur ce navigateur.', 'Mix is too long to render in this browser’s memory.'));
    const offline = new OfflineAudioContext(2, Math.ceil(duration * rate), rate), start = decks.a.duration - overlap();
    const limiter = offline.createDynamicsCompressor(); limiter.threshold.value = -2; limiter.knee.value = 3; limiter.ratio.value = 10; limiter.connect(offline.destination);
    for (const which of ['a', 'b']) {
      const audio = decks[which].buffer, source = offline.createBufferSource(), gain = offline.createGain(), filter = offline.createBiquadFilter();
      source.buffer = audio; filter.type = 'lowpass'; filter.Q.value = .7; filter.frequency.value = 22000;
      source.connect(filter); filter.connect(gain); gain.connect(limiter);
      if (which === 'a') {
        source.start(0);
        gain.gain.setValueAtTime(1, Math.max(0, start));
        if (readTransition().style === 'filter') { filter.frequency.setValueAtTime(22000, Math.max(0, start)); filter.frequency.linearRampToValueAtTime(450, Math.max(0, start) + overlap()); }
        gain.gain.linearRampToValueAtTime(0, start + overlap());
      } else {
        source.start(start);
        gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(1, start + overlap());
        if (readTransition().style === 'filter') { filter.frequency.setValueAtTime(450, start); filter.frequency.linearRampToValueAtTime(22000, start + overlap()); }
      }
      if (readTransition().style === 'eq') {
        const low = offline.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 180;
        filter.disconnect(); filter.connect(low); low.connect(gain);
        low.gain.setValueAtTime(which === 'a' ? 0 : -7, start);
        low.gain.linearRampToValueAtTime(which === 'a' ? -7 : 0, start + overlap());
      }
    }
    return offline.startRendering();
  }

  async function exportMix() {
    const button = $('#mixExportButton'); button.disabled = true;
    try { stopAudio(false); status(label('Rendu du mix stéréo…', 'Rendering stereo mix…')); const rendered = await renderFullMix(); const blob = encodeWav(rendered), link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${($('#mixNameInput').value.trim() || 'audiosplit-mix').replace(/[<>:"/\\|?*]/g, '_')}.wav`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); status(label('Mix exporté en WAV stéréo.', 'Mix exported as stereo WAV.')); }
    catch (error) { status(error.message, true); }
    finally { button.disabled = false; }
  }

  async function saveMix() {
    const button = $('#mixSaveButton'); button.disabled = true;
    try {
      const folderId = $('#mixFolderSelect').value;
      if (!folderId) throw new Error(label('Créez ou choisissez un dossier dans Projets avant l’enregistrement.', 'Create or select a folder in Projects before saving.'));
      if (!decks.a || !decks.b) return;
      status(label('Préparation des pistes stéréo…', 'Preparing stereo decks…'));
      const form = new FormData();
      form.append('manifest', JSON.stringify({ name: $('#mixNameInput').value.trim() || `${decks.a.name} × ${decks.b.name}`, decks: { a: { name: decks.a.name, projectId: decks.a.projectId || null, sourceName: decks.a.sourceName, bpm: decks.a.bpm, key: decks.a.key, duration: decks.a.duration }, b: { name: decks.b.name, projectId: decks.b.projectId || null, sourceName: decks.b.sourceName, bpm: decks.b.bpm, key: decks.b.key, duration: decks.b.duration } }, transition: readTransition() }));
      form.append('deck_a', encodeWav(decks.a.buffer), 'deck_a.wav'); form.append('deck_b', encodeWav(decks.b.buffer), 'deck_b.wav');
      let saved;
      if (activeMixId) saved = await apiJson(`/api/library/mixes/${activeMixId}`, { method: 'PATCH', body: JSON.stringify({ name: $('#mixNameInput').value.trim() || `${decks.a.name} × ${decks.b.name}`, transition: readTransition() }) });
      else saved = await apiJson(`/api/library/folders/${folderId}/mixes`, { method: 'POST', body: form });
      activeMixId = saved.id; mixFolderId = saved.folderId; await refreshLibrary(); updateControls(); status(label('Mixage enregistré dans le dossier.', 'Mix saved to the folder.'));
    } catch (error) { status(error.message, true); }
    finally { button.disabled = false; }
  }

  async function openSavedMix(id) {
    try {
      const data = await apiJson(`/api/library/mixes/${id}`);
      const decodedEstimate = Object.values(data.fileBytes || {}).reduce((sum, bytes) => sum + Number(bytes || 0), 0) * 2;
      if (decodedEstimate > 1024 * 1024 * 1024) throw new Error(label('Ce mixage est trop volumineux pour être ouvert dans le navigateur.', 'This mix is too large to open in the browser.'));
      stopAudio(); status(label('Chargement du mixage…', 'Loading mix…'));
      for (const which of ['a', 'b']) { const response = await fetch(data.audio[which]); if (!response.ok) throw new Error(label('Impossible de charger le mixage enregistré.', 'Could not load saved mix.')); const buffer = await context.decodeAudioData(await response.arrayBuffer()); decks[which] = { ...data.decks[which], buffer, duration: buffer.duration }; updateDeckCard(which); }
      activeMixId = id; mixFolderId = data.folderId; $('#mixNameInput').value = data.name; $('#mixTransitionStyle').value = data.transition?.style || 'crossfade'; $('#mixTransitionDuration').value = data.transition?.duration || 8;
      $('#mixFolderSelect').value = data.folderId; offset = 0; updateDeckCard('a'); updateDeckCard('b'); updateControls();
      if (location.hash !== '#mix') window.location.hash = 'mix';
      status(label('Mixage ouvert dans Mix.', 'Mix opened in Mix.'));
    } catch (error) { status(error.message, true); }
  }

  async function enter() {
    try { await refreshLibrary(); } catch (error) { status(error.message, true); }
    const folders = getLibrary().folders || [];
    $('#mixFolderSelect').innerHTML = folders.map(folder => `<option value="${folder.id}">${escapeHtml(folder.name)}</option>`).join('');
    if (mixFolderId && folders.some(folder => folder.id === mixFolderId)) $('#mixFolderSelect').value = mixFolderId;
    if (mixFolderId === null && folders[0]) mixFolderId = folders[0].id;
    setLanguage(); updateControls();
    requestAnimationFrame(() => { draw('a'); draw('b'); });
  }

  function setLanguage() {
    const english = language() === 'en';
    const text = (selector, fr, en) => { const node = $(selector, page); if (node) node.textContent = english ? en : fr; };
    text('.mix-page-heading .eyebrow', 'DEUX PISTES · UN MIX', 'TWO DECKS · ONE MIX');
    text('#mixPageTitle', 'Mix', 'Mix');
    text('.mix-page-heading p:last-child', 'Assemblez deux projets, façonnez leur transition et exportez un seul fichier stéréo.', 'Combine two projects, shape their transition, and export one stereo file.');
    text('.mix-deck-a .mix-deck-heading p', 'PISTE 1', 'DECK 1'); text('.mix-deck-b .mix-deck-heading p', 'PISTE 2', 'DECK 2');
    $('.mix-remove[data-mix-remove="a"]')?.setAttribute('aria-label', label('Retirer la piste 1', 'Remove deck 1'));
    $('.mix-remove[data-mix-remove="b"]')?.setAttribute('aria-label', label('Retirer la piste 2', 'Remove deck 2'));
    if (!decks.a) text('.mix-deck-a [data-mix-name="a"]', 'Emplacement libre', 'Empty deck');
    if (!decks.b) text('.mix-deck-b [data-mix-name="b"]', 'Emplacement libre', 'Empty deck');
    text('.mix-deck-a [data-mix-empty="a"] p', 'Choisissez une séparation enregistrée : elle sera réduite à une seule piste stéréo.', 'Choose a saved separation; it will be flattened to one stereo track.');
    text('.mix-deck-b [data-mix-empty="b"] p', 'Choisissez une seconde séparation : le mix conservera les deux pistes sous forme de decks indépendants.', 'Choose a second separation; both source tracks will remain as independent decks.');
    page.querySelectorAll('[data-mix-pick="a"], [data-mix-pick="b"]').forEach(button => { button.textContent = label('Choisir depuis un projet', 'Choose from a project'); });
    text('.mix-transition-heading .eyebrow', 'TRANSITION', 'TRANSITION');
    text('#mixTransitionTitle', 'Passage entre les pistes', 'Transition between tracks');
    text('.mix-transition-heading p:last-child', 'Le croisement se place à la fin de la piste 1 et au début de la piste 2.', 'The transition sits at the end of deck 1 and the beginning of deck 2.');
    $('#mixStopButton').textContent = label('Début', 'Start');
    text('.mix-save-card .eyebrow', 'BIBLIOTHÈQUE LOCALE', 'LOCAL LIBRARY');
    text('#mixSaveTitle', 'Enregistrer ce mixage', 'Save this mix');
    text('.mix-save-card > div:first-child p:last-child', 'Les deux decks stéréo et les réglages de transition seront conservés dans le dossier choisi.', 'Both stereo decks and transition settings will be saved in the selected folder.');
    $('#mixNameInput').placeholder = label('Nom du mixage', 'Mix name');
    $('#mixSaveButton').textContent = label('Enregistrer le mixage', 'Save mix'); $('#mixExportButton').textContent = label('Exporter WAV stéréo', 'Export stereo WAV');
    const currentStyle = $('#mixTransitionStyle').value;
    $('#mixTransitionStyle').innerHTML = `<option value="crossfade">${label('Fondu croisé', 'Crossfade')}</option><option value="eq">${label('Échange des basses', 'Bass EQ swap')}</option><option value="filter">${label('Balayage de filtre', 'Filter sweep')}</option>`;
    $('#mixTransitionStyle').value = currentStyle || 'crossfade';
    $('#mixFolderSelect').setAttribute('aria-label', label('Dossier de destination', 'Destination folder'));
    $('#mixPickerClose').setAttribute('aria-label', label('Fermer', 'Close'));
    const pickerDescription = $('#mixPickerTitle')?.parentElement?.querySelector('p:last-child');
    if (pickerDescription) pickerDescription.textContent = label('Les pistes du projet seront réduites en une piste stéréo.', 'The project stems will be flattened into one stereo track.');
    const saveLabels = $('#mixSaveTitle')?.closest('.mix-save-card')?.querySelectorAll('.mix-save-controls label > span');
    if (saveLabels?.[0]) saveLabels[0].textContent = label('Nom du mixage', 'Mix name');
    if (saveLabels?.[1]) saveLabels[1].textContent = label('Dossier', 'Folder');
    const transitionLabels = $('#mixTransitionStyle').closest('.mix-transition-controls')?.querySelectorAll('label > span');
    if (transitionLabels?.[0]) transitionLabels[0].textContent = label('Type de transition', 'Transition type');
    if (transitionLabels?.[1]) transitionLabels[1].firstChild.textContent = label('Durée du passage ', 'Transition length ');
    $('#mixTimeline').setAttribute('aria-label', label('Position de lecture du mix', 'Mix playback position'));
    updateControls();
  }

  page.addEventListener('click', event => {
    const pick = event.target.closest('[data-mix-pick]'); if (pick) { if (loadingDeck) return; pickTarget = pick.dataset.mixPick; pickerOpener = pick; renderPicker(); }
    const remove = event.target.closest('[data-mix-remove]'); if (remove) { stopAudio(); decks[remove.dataset.mixRemove] = null; updateDeckCard(remove.dataset.mixRemove); activeMixId = null; }
  });
  $('#mixPickerClose').onclick = closePicker; $('[data-picker-close]').onclick = closePicker;
  $('#mixPickerModal').addEventListener('click', event => { if (event.target === $('#mixPickerModal')) closePicker(); });
  $('#mixPlayButton').onclick = () => { if (paused) void startPlayback(offset); else { offset = Math.min(totalDuration(), (performance.now() - startedAt) / 1000); stopAudio(false); updateControls(); } };
  $('#mixStopButton').onclick = () => { stopAudio(); $('#mixTimeline').value = '0'; $('#mixTimelineNow').textContent = '0:00'; };
  $('#mixTimeline').oninput = event => { offset = Number(event.target.value); $('#mixTimelineNow').textContent = fmt(offset); if (!paused) void startPlayback(offset); };
  $('#mixExportButton').onclick = () => void exportMix(); $('#mixSaveButton').onclick = () => void saveMix();
  $('#mixTransitionStyle').onchange = () => { draw('a'); draw('b'); if (!paused) void startPlayback(offset); };
  $('#mixTransitionDuration').oninput = () => { $('#mixTransitionDurationValue').textContent = `${$('#mixTransitionDuration').value} s`; updateControls(); draw('a'); draw('b'); if (!paused) void startPlayback(offset); };
  $('#mixFolderSelect').onchange = event => { const chosen = event.target.value || null; if (activeMixId && chosen !== mixFolderId) activeMixId = null; mixFolderId = chosen; updateControls(); };
  window.addEventListener('resize', () => { draw('a'); draw('b'); });
  return { enter, openSavedMix, setLanguage };
}
