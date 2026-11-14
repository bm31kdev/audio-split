import { $, tracks, automationByTrack, effectDefaults, MAX_DECODED_STEM_BYTES, MAX_EXPORT_WORKING_BYTES, WAV_RIFF_MAX_BYTES, effectsByTrack, audioCtx, autosaveNotice, clockTime, status, startSeparationProgressPolling, stopSeparationProgressPolling, ensureAudioContext, getAudioContext, settings, updateLiveMix, updateOutputs, formatTime, tickStep, getAutomationPan, combinedPan, trackHasEffect, disposeTrackNodes, createTrackNodes, updateTrackEffects, schedulePan, drawWaveform, stemInfo, icon, speakerIcon, playIcon, pauseIcon, setTransportState, ensureAutomation, automationCoordinates, selectAutomationPoint, moveAutomationPoint, refreshAutomation, bindAutomation, fxModalInstance, setFxModal, bindFxButtons, getSaturationTarget, getWidthTarget, timelineDuration, updatePlayheads, seekMix, seekFromPlayhead, bindPlayheadSeeking, startPlaybackSources, createMasterLimiter, effectTailSeconds, animatePlayheads, stop, playMix, playing, paused, playStartedAt, apiJson } from './js/audio-engine.js?v=1.3.6.1';
import { bindModalAccessibility, createChangelogModal, createFxModal, createLanguageModal, mountModalComponents } from './js/modal-manager.js?v=1.3.6.1';
import { applyTranslations, onLanguageChange, getLanguage, t } from './js/i18n.js?v=1.3.6.1';
import { libraryLabels } from './js/library-text.js?v=1.3.6.1';
import { mountButtonComponent } from './js/button-component.js?v=1.3.6.1';
import { snapshotTrackControls, savePayload, renderTracks } from './js/track-state.js?v=1.3.6.1';

await mountButtonComponent($('#buttonComponentRoot'));

let fxModal, changelogModal, languageModal;
let libraryModal, currentJobId = null, currentSourceName = '', currentMode = 'simple', currentEngine = 'fast', activeProjectId = null;
let projectDirty = false, projectSaving = false, projectRevision = 0;
let activeSeparationRequestId = null, separationPollTimer, separationPollBusy = false, separationCancelRequested = false;
function userFacingError(error, fallbackKey) {
  const message = String(error?.message || '').trim();
  if (error instanceof TypeError || !message || message.length > 240 || /failed to fetch|networkerror|load failed/i.test(message)) return t(fallbackKey);
  return message;
}
function markProjectDirty() { window.dispatchEvent(new Event('audiosplit:project-dirty')); }
window.addEventListener('audiosplit:project-dirty', () => {
  if (!activeProjectId && !currentJobId) return;
  projectDirty = true; projectRevision += 1; autosaveNotice('dirty');
});

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
  workspace.innerHTML = `${warningHtml}<nav class="library-folders">${libraryData.folders.map(folder => `<button type="button" data-button-variant="modal" data-folder="${folder.id}" class="library-folder ${folder.id === current.id ? 'active' : ''}"><span>${escapeHtml(folder.name)}</span><small>${folder.projects.length}</small></button>`).join('')}</nav><section class="library-projects"><div class="library-folder-heading"><h3>${escapeHtml(current.name)}</h3><div><button type="button" data-button-variant="modal" data-rename-folder="${current.id}">${labels.rename}</button><button type="button" data-button-variant="danger" data-delete-folder="${current.id}">${labels.remove}</button></div></div>${current.projects.length ? current.projects.map(project => `<article class="library-project"><div><h4>${escapeHtml(project.name)}</h4><p>${escapeHtml(project.sourceName || '')} · ${new Date(project.updatedAt).toLocaleDateString(getLanguage() === 'en' ? 'en-US' : 'fr-FR')}</p></div><div><button type="button" data-button-variant="modal" data-open-project="${project.id}">${labels.open}</button><button type="button" data-button-variant="modal" data-export-project="${project.id}">${labels.exportArchive}</button><button type="button" data-button-variant="modal" data-rename-project="${project.id}">${labels.rename}</button><button type="button" data-button-variant="danger" data-delete-project="${project.id}">${labels.remove}</button></div></article>`).join('') : `<p class="library-empty">${labels.noProjects}</p>`}</section>`;
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
    } catch (error) { status(userFacingError(error, 'status.actionError'), true); }
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
    } catch (error) { status(userFacingError(error, 'status.actionError'), true); }
  });
}
async function renameLibraryItem(url, oldName) {
  const value = prompt(getLanguage() === 'en' ? 'New name:' : 'Nouveau nom :', oldName);
  if (!value?.trim()) return;
  try { await apiJson(url, { method: 'PATCH', body: JSON.stringify({ name: value.trim() }) }); await refreshLibrary(); }
  catch (error) { status(userFacingError(error, 'status.actionError'), true); }
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
    ensureAudioContext();
    clearMixerForReplacement();
    status(getLanguage() === 'en' ? 'Loading project audio…' : 'Chargement de l’audio du projet…');
    const decoded = [];
    for (const name of project.stems) {
      const response = await fetch(project.audio[name]);
      if (!response.ok) throw new Error(`${name}: ${response.statusText}`);
      const bytes = await response.arrayBuffer();
      decoded.push([name, await getAudioContext().decodeAudioData(bytes)]);
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
  } catch (error) { console.error('Could not load local project.', error); status(userFacingError(error, 'status.actionError'), true); }
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
    console.error('Project save failed.', error);
    const message = userFacingError(error, 'status.actionError');
    status(message, true);
    autosaveNotice(automatic ? 'error' : 'manualError', message);
    return false;
  } finally { projectSaving = false; }
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
function encodeWavInWorker(buffer) {
  const worker = new Worker(new URL('./js/wav-encoder-worker.js?v=1.3.6.1', import.meta.url), { type: 'module' });
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
    if (wavBytes - 44 + 36 > WAV_RIFF_MAX_BYTES) throw new Error(t('status.exportTooLarge'));
    const offline = new OfflineAudioContext(2, renderLength, rate), master = createMasterLimiter(offline);
    const offlineNodes = new Map();
    for (const [name, buffer] of Object.entries(tracks)) { const source=offline.createBufferSource(),cfg=settings(name),nodes=createTrackNodes(offline,source,name,cfg,master); source.buffer=buffer;schedulePan(nodes.panner,name,cfg,0,0,buffer.duration);source.start();offlineNodes.set(name,nodes); }
    // Offline rendering has no animation frame, so schedule the vocal envelope in advance.
    if (tracks.vocals) {
      const vocalSettings = settings('vocals');
      const vocalGain = vocalSettings.muted ? 0 : vocalSettings.volume;
      for (const [name, nodes] of offlineNodes) {
        if (nodes.effects.ducking) scheduleOfflineVoiceDucking(nodes.effects.ducking, tracks.vocals, settings(name).effects.ducking, offline, vocalGain);
      }
    }
    for (const [name, nodes] of offlineNodes) if (nodes.effects.deEsser) scheduleOfflineDeEsser(nodes.effects.deEsser, tracks[name], settings(name).effects.deEsser);
    for (const [name, nodes] of offlineNodes) if (nodes.effects.gate) scheduleOfflineNoiseGate(nodes.effects.gate, tracks[name], settings(name).effects.gate, offline);
    status(t('status.rendering')); const rendered=await offline.startRendering(), result=await encodeWavInWorker(rendered), url=URL.createObjectURL(result.blob), link=document.createElement('a');link.href=url;link.download='audiosplit-mix-stereo.wav';link.click();setTimeout(() => URL.revokeObjectURL(url), 1000);status(result.normalized ? t('status.exportedNormalized') : t('status.exported'));
  } catch (error) {
    console.error('Audio export failed.', error);
    status(error.message === t('status.exportMemoryLimit') || error.message === t('status.exportTooLarge') ? error.message : t('status.exportError'), true);
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
    ensureAudioContext();
    clearMixerForReplacement();
    status(getLanguage() === 'en' ? 'Loading separated tracks…' : 'Chargement des pistes séparées…');
    const names = Object.keys(data.stems);
    const decoded = [];
    for (const name of names) {
      const stemResponse = await fetch(`${data.stems[name]}?lang=${getLanguage()}`);
      if (!stemResponse.ok) throw Error(t('status.trackMissing', { track: t(stemInfo[name].titleKey) }));
      const bytes = await stemResponse.arrayBuffer();
      decoded.push([name, await getAudioContext().decodeAudioData(bytes)]);
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
    status(separationCancelRequested ? t('status.cancelled') : userFacingError(error, 'status.separationError'), !separationCancelRequested);
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
    await apiJson(`/api/separations/${requestId}/cancel?lang=${getLanguage()}`, { method: 'POST' });
    separationCancelRequested = true;
    status(t('status.canceling'));
  } catch (error) {
    console.error('Could not cancel separation.', error);
    button.disabled = false;
    status(userFacingError(error, 'status.cancelError'), true);
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
    status(userFacingError(error, 'status.actionError'), true);
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
      getSaturationTarget,
      getWidthTarget,
      getValues: (name) => effectsByTrack[name] || { ...effectDefaults },
      setValue: (name, key, value) => { effectsByTrack[name][key] = value; updateLiveMix(); markProjectDirty(); },
    });
    setFxModal(fxModal);
    changelogModal = createChangelogModal($('#versionButton'));
    languageModal = createLanguageModal($('#languageButton'));
    const libraryElement = $('#libraryModal'), libraryTrigger = $('#libraryButton');
    bindModalAccessibility(libraryElement);
    const closeLibrary = () => { libraryElement.classList.remove('is-open'); setTimeout(() => { libraryElement.setAttribute('aria-hidden', 'true'); libraryTrigger.focus(); }, 240); };
    libraryElement.querySelectorAll('[data-library-close]').forEach(button => button.onclick = closeLibrary);
    libraryTrigger.onclick = async () => {
      try { await refreshLibrary(); } catch (error) { status(userFacingError(error, 'status.actionError'), true); }
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
      catch (error) { status(userFacingError(error, 'status.actionError'), true); }
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
        status(userFacingError(error, 'status.actionError'), true);
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
      updatePlayheads(Math.max(0, getAudioContext() ? getAudioContext().currentTime - playStartedAt : 0));
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
