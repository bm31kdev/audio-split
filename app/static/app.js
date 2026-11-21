import { $, tracks, automationByTrack, effectDefaults, MAX_DECODED_STEM_BYTES, MAX_EXPORT_WORKING_BYTES, WAV_RIFF_MAX_BYTES, effectsByTrack, audioCtx, autosaveNotice, clockTime, status, startSeparationProgressPolling, stopSeparationProgressPolling, ensureAudioContext, getAudioContext, settings, updateLiveMix, updateOutputs, formatTime, tickStep, getAutomationPan, automationValue, combinedPan, disposeTrackNodes, createTrackNodes, updateTrackEffects, schedulePan, drawWaveform, stemInfo, icon, speakerIcon, playIcon, pauseIcon, setTransportState, setPlaybackLabel, ensureAutomation, automationCoordinates, selectAutomationPoint, moveAutomationPoint, refreshAutomation, bindAutomation, fxModalInstance, setFxModal, panCurveModalInstance, setPanCurveModal, setAutomationEffectModal, removeTrackEffect, bindFxButtons, getSaturationTarget, getWidthTarget, timelineDuration, updatePlayheads, seekMix, seekFromPlayhead, bindPlayheadSeeking, startPlaybackSources, createMasterLimiter, effectTailSeconds, animatePlayheads, stop, playMix, playing, paused, playStartedAt, playheadOffset, apiJson, generateAutomationCurvePoints } from './js/audio-engine.js?v=1.5.0.73';
import { createAutomationEffectModal, createChangelogModal, createFxModal, createInteractionModal, createKeyModal, createLanguageModal, createMusicAnalysisModal, createPanCurveModal, createReleaseDetailsModal, createSettingsModal, createShortcutsModal, createTransformModal, mountModalComponents } from './js/modal-manager.js?v=1.5.0.73';
import { applyTranslations, onLanguageChange, getLanguage, t } from './js/i18n.js?v=1.5.0.73';
import { libraryLabels } from './js/library-text.js?v=1.5.0.73';
import { mountButtonComponent } from './js/button-component.js?v=1.5.0.73';
import { snapshotTrackControls, savePayload, renderTracks } from './js/track-state.js?v=1.5.0.73';
import { renderPresets, bindPresetControls } from './js/library-presets.js?v=1.5.0.73';
import { userFacingError } from './js/ui-errors.js?v=1.5.0.73';
import { lucideIcon } from './js/lucide.js?v=1.5.0.73';
import { scheduleOfflineDeEsser } from './js/effects/de-esser.js?v=1.5.0.73';
import { scheduleOfflineNoiseGate } from './js/effects/noise-gate.js?v=1.5.0.73';
import { scheduleOfflineVoiceDucking } from './js/effects/voice-ducking.js?v=1.5.0.73';
import { analyzeAudioFile, formatDbfs, formatDuration } from './js/music-analysis.js?v=1.5.0.73';
import { enhanceStyledDropdowns } from './js/styled-dropdowns.js?v=1.5.0.73';
import { getShortcutAction } from './js/keyboard-shortcuts.js?v=1.5.0.73';
enhanceStyledDropdowns(document);
await mountButtonComponent($('#buttonComponentRoot'));
let fxModal, changelogModal, languageModal, settingsModal, interactionModal, keyModal, transformModal, automationEffectModal, musicAnalysisModal, shortcutsModal;
let panCurvesModal;
let resolveInteractionModalReady;
const interactionModalReady = new Promise(resolve => { resolveInteractionModalReady = resolve; });
let resolveAnalysisModalReady;
const analysisModalReady = new Promise(resolve => { resolveAnalysisModalReady = resolve; });
const getInteractionModal = () => interactionModal ? Promise.resolve(interactionModal) : interactionModalReady;
let currentJobId = null, currentSourceName = '', currentMode = 'simple', currentEngine = 'mdx', activeProjectId = null;
let projectDirty = false, projectSaving = false, projectRevision = 0;
let trackCutStart = null;
let activeTrackName = null;
let lastPointerPosition = null;
let activeSeparationRequestId = null, separationCancelRequested = false;
let analysisRequestId = 0, currentMusicAnalysis = null, currentAnalysisStatusKey = 'analysis.waiting', currentAnalysisFile = null, analysisPromise = Promise.resolve(null);
let currentMixTransform = { tempoRatio: 1, pitchSemitones: 0, sourceBpm: null, targetBpm: null };
let renderedTransform = { ...currentMixTransform }, transformBusy = false;
function showAppPage(page, { updateHash = true } = {}) {
  const requested = ['home', 'projects', 'studio'].includes(page) ? page : 'projects';
  // Audio buffers only live in memory. After a browser reload, never reveal an empty studio shell.
  const emptyStudio = requested === 'studio' && !Object.keys(tracks).length;
  const target = emptyStudio ? 'projects' : requested;
  const pageVisibility = { home: '#homePage', studio: '#studioPage', projects: '#libraryModal' };
  Object.entries(pageVisibility).forEach(([pageName, selector]) => {
    const pageElement = $(selector);
    if (!pageElement) return;
    const hidden = pageName !== target;
    pageElement.hidden = hidden;
    pageElement.classList.toggle('hidden', hidden);
  });
  document.querySelectorAll('[data-page]').forEach(button => {
    const active = button.dataset.page === target;
    button.classList.toggle('is-current', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  if (updateHash || emptyStudio) history.replaceState(null, '', `#${target}`);
  if (emptyStudio) {
    requestAnimationFrame(() => status(getLanguage() === 'en'
      ? 'The studio session was cleared when the page reloaded. Reopen a saved project from Projects.'
      : 'La session du studio a été réinitialisée au rechargement. Rouvrez un projet enregistré depuis Projets.'));
  }
}
document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', async () => {
  const page = button.dataset.page;
  if (page === 'studio' && !Object.keys(tracks).length) {
    showAppPage('home');
    status(getLanguage() === 'en' ? 'Open a project or separate a track to enter the studio.' : 'Ouvrez un projet ou séparez un morceau pour accéder au studio.', true);
    return;
  }
  if (page === 'projects') {
    showAppPage('projects');
    try { await refreshLibrary(); } catch (error) { status(userFacingError(error, 'status.actionError'), true); }
    return;
  }
  showAppPage(page);
}));
function markProjectDirty() { window.dispatchEvent(new Event('audiosplit:project-dirty')); }
window.addEventListener('audiosplit:project-dirty', () => {
  if (!activeProjectId && !currentJobId) return;
  projectDirty = true; projectRevision += 1; autosaveNotice(activeProjectId ? 'dirty' : 'waiting');
});

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function formatBytes(value) { let size = Number(value || 0), unit = 'B'; for (const next of ['KiB', 'MiB', 'GiB']) { if (size < 1024) break; size /= 1024; unit = next; } return `${size.toFixed(unit === 'B' ? 0 : 1)} ${unit}`; }
const separationEngineIds = new Set(['mdx', 'mdx_extra', 'htdemucs', 'htdemucs_ft']);
function normalizeSeparationEngine(engine) {
  const aliases = { fast: 'mdx', studio: 'htdemucs' };
  const normalized = aliases[engine] || engine;
  return separationEngineIds.has(normalized) ? normalized : 'mdx';
}
function getSavedSeparationEngine() {
  try { return normalizeSeparationEngine(localStorage.getItem('audiosplit.separationEngine') || 'mdx'); }
  catch { return 'mdx'; }
}
function libraryActionIcon(action) {
  const names = { open: 'folder-open', duplicate: 'copy', export: 'download', rename: 'pencil', delete: 'trash-2' };
  return lucideIcon(names[action], { size: 17 });
}
let libraryData = { folders: [] }, presetData = [], selectedFolderId = null;
function updateStudioProjectButton() {
  const button = $('#saveMixAsProjectButton');
  const label = button?.querySelector('span');
  if (label) label.textContent = activeProjectId ? libraryLabels().manageProject : libraryLabels().saveFromStudio;
}
async function refreshLibrary() {
  libraryData = await apiJson('/api/library');
  const presetResult = await apiJson('/api/library/presets');
  presetData = presetResult.presets || [];
  if (!libraryData.folders.some(folder => folder.id === selectedFolderId)) selectedFolderId = libraryData.folders[0]?.id || null;
  renderLibrary();
}
function renderLibrary() {
  const labels = libraryLabels(), workspace = $('#libraryWorkspace'), select = $('#saveFolderSelect');
  const warnings = libraryData.warnings || [];
  const recovery = libraryData.recovery || {};
  const warningHtml = warnings.length ? `<p class="library-warning" role="alert">${getLanguage() === 'en' ? `${warnings.length} local item${warnings.length === 1 ? '' : 's'} could not be read. A manifest backup was checked when available.` : `${warnings.length} élément${warnings.length === 1 ? '' : 's'} local${warnings.length === 1 ? '' : 'aux'} n’a pu être lu. Une sauvegarde de manifeste a été essayée lorsqu’elle était disponible.`}</p>` : '';
  const recoveryHtml = recovery.restored ? `<p class="library-recovery" role="status">${t('library.recovered', { count: recovery.restored })}</p>` : recovery.discarded ? `<p class="library-recovery" role="status">${t('library.cleaned', { count: recovery.discarded })}</p>` : '';
  $('#libraryTitle').textContent = labels.title;
  $('#libraryDescription').textContent = labels.description;
  $('#newFolderName').placeholder = labels.folder;
  $('#createFolderButton').textContent = labels.create;
  $('#importProjectButton').textContent = labels.importArchive;
  $('#saveProjectHeading').textContent = labels.currentTitle;
  $('#saveProjectHint').textContent = labels.hint || (getLanguage() === 'en' ? 'A project includes separated tracks and all mixer settings.' : 'Un projet contient les pistes séparées et tous les réglages du mixeur.');
  updateStudioProjectButton();
  $('#projectNameInput').placeholder = labels.name;
  $('#saveProjectButton').textContent = activeProjectId ? labels.update : labels.save;
  $('#saveProjectPanel').classList.toggle('hidden', !Object.keys(tracks).length || (!currentJobId && !activeProjectId));
  const storage = libraryData.storage || {};
  const storageLabel = getLanguage() === 'en' ? 'Projects + presets' : 'Projets + préréglages';
  $('#libraryStorage').innerHTML = `<span>${storageLabel} : <strong>${formatBytes(storage.libraryBytes)}</strong> / ${formatBytes(storage.libraryLimitBytes)}</span><span>${getLanguage() === 'en' ? 'Separations to clear' : 'Séparations temporaires'} : <strong>${formatBytes(storage.jobBytes)}</strong></span><span>${getLanguage() === 'en' ? 'Imported audio copies to clear' : 'Copies audio temporaires'} : <strong>${formatBytes(storage.uploadBytes)}</strong> / ${formatBytes(storage.cacheLimitBytes)} ${getLanguage() === 'en' ? 'cache limit total' : 'limite cache totale'}</span><span>${getLanguage() === 'en' ? 'Free disk space' : 'Espace disque libre'} : <strong>${formatBytes(storage.freeBytes)}</strong></span>`;
  $('#projectSearchInput').placeholder = getLanguage() === 'en' ? 'Search projects…' : 'Rechercher un projet…';
  const sortSelect = $('#projectSortSelect');
  const previousSort = sortSelect.value;
  sortSelect.setAttribute('aria-label', getLanguage() === 'en' ? 'Sort projects' : 'Trier les projets');
  sortSelect.innerHTML = getLanguage() === 'en' ? '<option value="updated">Recently updated</option><option value="name">Name</option><option value="size">Size</option><option value="created">Created</option>' : '<option value="updated">Plus récents</option><option value="name">Nom</option><option value="size">Taille</option><option value="created">Date de création</option>';
  sortSelect.value = previousSort || 'updated';
  $('#presetHeading').textContent = getLanguage() === 'en' ? 'Mix presets' : 'Préréglages de mix';
  $('#presetHint').textContent = getLanguage() === 'en' ? 'Reuse mixer settings without duplicating audio files.' : 'Réutilisez les réglages sans dupliquer les fichiers audio.';
  $('#savePresetButton').textContent = getLanguage() === 'en' ? 'Save current mix as preset' : 'Enregistrer le mix comme préréglage';
  $('#importPresetButton').textContent = getLanguage() === 'en' ? 'Import' : 'Importer';
  renderPresets(presetData, { refreshLibrary, status, userFacingError, interactionModal });
  select.innerHTML = libraryData.folders.length ? libraryData.folders.map(folder => `<option value="${folder.id}" ${folder.id === selectedFolderId ? 'selected' : ''}>${escapeHtml(folder.name)}</option>`).join('') : `<option value="">${labels.select}</option>`;
  const current = libraryData.folders.find(folder => folder.id === selectedFolderId);
  const query = $('#projectSearchInput').value.trim().toLocaleLowerCase();
  const allProjects = libraryData.folders.flatMap(folder => folder.projects.map(project => ({ ...project, folderName: folder.name })));
  const matches = allProjects.filter(project => !query || `${project.name} ${project.sourceName || ''} ${project.folderName}`.toLocaleLowerCase().includes(query));
  const sortBy = sortSelect.value || 'updated';
  matches.sort((a, b) => sortBy === 'name' ? a.name.localeCompare(b.name) : sortBy === 'size' ? (b.sizeBytes || 0) - (a.sizeBytes || 0) : sortBy === 'created' ? String(b.createdAt).localeCompare(String(a.createdAt)) : String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (!current) { workspace.innerHTML = `${warningHtml}${recoveryHtml}<p class="library-empty">${labels.empty}</p>`; return; }
  const projectCards = query ? [...matches] : [...current.projects];
  projectCards.sort((a, b) => sortBy === 'name'
    ? a.name.localeCompare(b.name)
    : sortBy === 'size'
      ? (b.sizeBytes || 0) - (a.sizeBytes || 0)
      : sortBy === 'created'
        ? String(b.createdAt).localeCompare(String(a.createdAt))
        : String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const projectsWithFolder = projectCards.map(project => ({ ...project, folderName: project.folderName || current.name }));
  const actionButton = (projectId, action, label, variant = 'modal') => `<button type="button" class="library-action" data-button-size="library-action" data-button-variant="${variant}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" data-${action}-project="${projectId}">${libraryActionIcon(action)}</button>`;
  const projectHtml = projectsWithFolder.length ? projectsWithFolder.map(project => `<article class="library-project"><div class="library-project-info"><h4>${escapeHtml(project.name)}</h4><p>${escapeHtml(project.folderName)} · ${escapeHtml(project.sourceName || '')} · ${formatBytes(project.sizeBytes)} · ${new Date(project.updatedAt).toLocaleDateString(getLanguage() === 'en' ? 'en-US' : 'fr-FR')}</p></div><div class="library-project-actions">${actionButton(project.id, 'open', labels.open)}${actionButton(project.id, 'duplicate', getLanguage() === 'en' ? 'Duplicate project' : 'Dupliquer le projet')}${actionButton(project.id, 'export', labels.exportArchive)}${actionButton(project.id, 'rename', labels.rename)}${actionButton(project.id, 'delete', labels.remove, 'danger')}</div></article>`).join('') : `<p class="library-empty">${query ? (getLanguage() === 'en' ? 'No projects match your search.' : 'Aucun projet ne correspond à cette recherche.') : labels.noProjects}</p>`;
  workspace.innerHTML = `${warningHtml}${recoveryHtml}<nav class="library-folders">${libraryData.folders.map(folder => `<button type="button" data-button-variant="modal" data-folder="${folder.id}" class="library-folder ${folder.id === current.id ? 'active' : ''}"><span>${escapeHtml(folder.name)}</span><small>${folder.projects.length}</small></button>`).join('')}</nav><section class="library-projects"><div class="library-folder-heading"><h3>${query ? (getLanguage() === 'en' ? 'Search results' : 'Résultats de recherche') : escapeHtml(current.name)}</h3><div>${!query ? `<button type="button" data-button-variant="modal" data-rename-folder="${current.id}">${labels.rename}</button><button type="button" data-button-variant="danger" data-delete-folder="${current.id}">${labels.remove}</button>` : ''}</div></div>${projectHtml}</section>`;
  workspace.querySelectorAll('[data-folder]').forEach(button => button.onclick = () => { selectedFolderId = button.dataset.folder; renderLibrary(); });
  workspace.querySelectorAll('[data-rename-folder]').forEach(button => button.onclick = () => void renameLibraryItem(`/api/library/folders/${button.dataset.renameFolder}`, current.name));
  workspace.querySelectorAll('[data-delete-folder]').forEach(button => button.onclick = async () => {
    const dialogs = await getInteractionModal();
    const confirmation = await dialogs.prompt({ title: labels.remove, description: labels.confirmFolder, inputLabel: t('interaction.folderExact'), expectedValue: current.name, exactHint: t('interaction.exactHint'), danger: true, acceptLabel: labels.remove });
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
  workspace.querySelectorAll('[data-rename-project]').forEach(button => button.onclick = () => { const project = allProjects.find(item => item.id === button.dataset.renameProject); void renameLibraryItem(`/api/library/projects/${project.id}`, project.name); });
  workspace.querySelectorAll('[data-duplicate-project]').forEach(button => button.onclick = async () => { try { if (activeProjectId === button.dataset.duplicateProject && projectDirty && !(await saveCurrentProject())) return; const copy = await apiJson(`/api/library/projects/${button.dataset.duplicateProject}/duplicate`, { method: 'POST', body: '{}' }); selectedFolderId = copy.folderId; await refreshLibrary(); status(getLanguage() === 'en' ? 'Project duplicated.' : 'Projet dupliqué.'); } catch (error) { status(userFacingError(error, 'status.actionError'), true); } });
  workspace.querySelectorAll('[data-delete-project]').forEach(button => button.onclick = async () => {
    const project = allProjects.find(item => item.id === button.dataset.deleteProject);
    if (!project) return;
    const dialogs = await getInteractionModal();
    const confirmation = await dialogs.prompt({ title: labels.remove, description: labels.confirmProject, inputLabel: t('interaction.projectExact'), expectedValue: project.name, exactHint: t('interaction.exactHint'), danger: true, acceptLabel: labels.remove });
    if (confirmation !== project.name) return;
    try {
      await apiJson(`/api/library/projects/${project.id}`, { method: 'DELETE', body: JSON.stringify({ confirmation }) });
      if (activeProjectId === project.id) { activeProjectId = null; currentJobId = null; projectDirty = false; }
      await refreshLibrary();
    } catch (error) { status(userFacingError(error, 'status.actionError'), true); }
  });
}
async function renameLibraryItem(url, oldName) {
  const dialogs = await getInteractionModal();
  const value = await dialogs.prompt({ title: t('interaction.renameTitle'), description: t('interaction.renameDescription'), inputLabel: t('interaction.newName'), value: oldName, acceptLabel: t('interaction.rename') });
  if (!value?.trim()) return;
  try { await apiJson(url, { method: 'PATCH', body: JSON.stringify({ name: value.trim() }) }); await refreshLibrary(); }
  catch (error) { status(userFacingError(error, 'status.actionError'), true); }
}
async function confirmCurrentMixReplacement() {
  if (transformBusy) {
    status(getLanguage() === 'en' ? 'Wait for the tempo/pitch render to finish before replacing the current mix.' : 'Attendez la fin du rendu tempo/tonalité avant de remplacer le mix actuel.', true);
    return false;
  }
  if (activeProjectId) {
    if (!projectDirty) return true;
    if (projectSaving) {
      status(getLanguage() === 'en' ? 'The current project is still saving. Try again in a moment.' : 'Le projet actuel est encore en cours de sauvegarde. Réessayez dans un instant.', true);
      return false;
    }
    return saveCurrentProject({ automatic: true });
  }
  if (currentJobId) {
    const dialogs = await getInteractionModal();
    return dialogs.confirm({ title: t('interaction.replaceTitle'), description: t('interaction.replaceMessage') });
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
    currentMixTransform = { tempoRatio: 1, pitchSemitones: 0, sourceBpm: null, targetBpm: null, ...(project.transform || {}) };
    currentMixTransform.pitchTrack = defaultPitchTrack(project.stems, currentMixTransform.pitchTrack);
    decoded.forEach(([name, buffer]) => {
      tracks[name] = buffer; effectsByTrack[name] = { ...effectDefaults, ...(project.effects?.[name] || {}) };
      const curve = project.automation?.[name] || { points: [{ time: 0, pan: 0 }, { time: buffer.duration, pan: 0 }], selected: 0 };
      const ratio = Number(currentMixTransform.tempoRatio) || 1;
      // Saved automation points use the transformed timeline; restore source time before rendering it again.
      const automationScale = time => time * ratio;
      automationByTrack[name] = { ...curve, points: curve.points.map(point => ({ ...point, time: automationScale(point.time) })), lanes: Object.fromEntries(Object.entries(curve.lanes || {}).map(([parameter, points]) => [parameter, points.map(point => ({ ...point, time: automationScale(point.time) }))])) };
    });
    renderedTransform = { ...currentMixTransform, tempoRatio: 1, pitchSemitones: 0 };
    setTransformInputs(currentMixTransform);
    currentSourceName = project.sourceName || project.name;
    setPlaybackLabel(project.name || currentSourceName);
    currentMode = project.mode || 'simple'; currentEngine = normalizeSeparationEngine(project.engine || getSavedSeparationEngine());
    document.querySelector(`input[name="splitMode"][value="${currentMode}"]`).checked = true;
    currentJobId = null; activeProjectId = project.id; projectDirty = false;
    updateStudioProjectButton();
    $('#fileName').textContent = currentSourceName;
    $('#projectNameInput').value = project.name;
    renderTracks(project.stems, project.settings || {});
    $('#mixer').classList.remove('hidden'); $('#exportButton').disabled = false;
    setTransportState();
    syncTransformUi();
    if (!sameRenderParameters(currentMixTransform, renderedTransform)) {
      status(getLanguage() === 'en' ? 'Restoring saved tempo and pitch settings…' : 'Restauration du tempo et de la tonalité du projet…');
      try { await renderTransform(currentMixTransform); }
      catch (error) {
        const detail = error.message || t('transform.error');
        currentMixTransform = { tempoRatio: 1, pitchSemitones: 0, sourceBpm: currentMixTransform.sourceBpm, targetBpm: currentMixTransform.sourceBpm, pitchTrack: currentMixTransform.pitchTrack };
        renderedTransform = { ...currentMixTransform };
        setTransformInputs(currentMixTransform);
        syncTransformUi();
        status(getLanguage() === 'en' ? `Saved tempo/pitch settings could not be restored: ${detail}. The original project audio is loaded.` : `Les réglages de tempo/tonalité n’ont pas pu être restaurés : ${detail}. L’audio original du projet est chargé.`, true);
      }
    }
    autosaveNotice('ready');
    requestAnimationFrame(() => { project.stems.forEach(name => drawWaveform(name, tracks[name])); project.stems.forEach(refreshAutomation); });
    showAppPage('studio'); status(getLanguage() === 'en' ? 'Project loaded from local storage.' : 'Projet chargé depuis le stockage local.');
  } catch (error) { console.error('Could not load local project.', error); status(userFacingError(error, 'status.actionError'), true); }
}
async function saveCurrentProject({ automatic = false } = {}) {
  if (transformBusy) {
    status(getLanguage() === 'en' ? 'Wait for the tempo/pitch render to finish before saving.' : 'Attendez la fin du rendu tempo/tonalité avant d’enregistrer.', true);
    return false;
  }
  if (!sameRenderParameters(renderedTransform, currentMixTransform)) {
    status(getLanguage() === 'en' ? 'Apply the current tempo/pitch preview before saving this project.' : 'Appliquez la préécoute de tempo/tonalité avant d’enregistrer le projet.', true);
    return false;
  }
  const labels = libraryLabels(), name = $('#projectNameInput').value.trim() || currentSourceName.replace(/\.[^.]+$/, '') || 'AudioSplit project';
  if (projectSaving || !Object.keys(tracks).length) return false;
  projectSaving = true;
  const savedRevision = projectRevision;
  const payload = savePayload();
  payload.transform = { ...currentMixTransform };
  autosaveNotice('saving');
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
    setPlaybackLabel(result.name || name);
    if (projectRevision === savedRevision) projectDirty = false;
    await refreshLibrary();
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
  updateStudioProjectButton();
  projectDirty = false;
  currentMixTransform = { tempoRatio: 1, pitchSemitones: 0, sourceBpm: null, targetBpm: null };
  renderedTransform = { ...currentMixTransform };
  setTransformInputs(currentMixTransform);
  $('#mixer').classList.add('hidden');
  $('#transformPanel').classList.add('hidden');
  transformModal?.close();
  $('#tracks').replaceChildren();
  $('#exportButton').disabled = true;
}
function encodeWavInWorker(buffer, confirmPeak) {
  const worker = new Worker(new URL('./js/wav-encoder-worker.js?v=1.5.0.73', import.meta.url), { type: 'module' });
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => new Float32Array(buffer.getChannelData(channel)));
  return new Promise((resolve, reject) => {
    worker.onmessage = async ({ data }) => {
      if (Number.isFinite(data.peak)) {
        try { worker.postMessage({ type: await confirmPeak(data.peak) ? 'continue' : 'cancel' }); }
        catch (error) { worker.terminate(); reject(error); }
        return;
      }
      worker.terminate();
      if (data.error) reject(new Error(data.error)); else resolve(data);
    };
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || 'WAV encoding worker failed.')); };
    worker.postMessage({ channels, sampleRate: buffer.sampleRate }, channels.map(channel => channel.buffer));
  });
}
async function openProjectSavePanel() {
  if (!Object.keys(tracks).length) return;
  try {
    await refreshLibrary();
    if (!libraryData.folders.length) {
      const folder = await apiJson('/api/library/folders', { method: 'POST', body: JSON.stringify({ name: libraryLabels().defaultFolder }) });
      selectedFolderId = folder.id;
      await refreshLibrary();
    }
    showAppPage('projects');
    requestAnimationFrame(() => {
      $('#saveProjectPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#projectNameInput').focus();
      if (!activeProjectId) $('#projectNameInput').select();
    });
  } catch (error) {
    status(userFacingError(error, 'status.actionError'), true);
  }
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
    for (const [name, buffer] of Object.entries(tracks)) { const source=offline.createBufferSource(),cfg=settings(name, 0),nodes=createTrackNodes(offline,source,name,cfg,master); source.buffer=buffer;schedulePan(nodes.panner,name,cfg,0,0,buffer.duration);source.start();offlineNodes.set(name,nodes); }
    // Offline rendering has no animation frame, so schedule the vocal envelope in advance.
    if (tracks.vocals) {
      const vocalSettings = settings('vocals', 0);
      const vocalGain = vocalSettings.muted ? 0 : vocalSettings.volume;
      for (const [name, nodes] of offlineNodes) {
        if (nodes.effects.ducking) scheduleOfflineVoiceDucking(nodes.effects.ducking, tracks.vocals, settings(name, 0).effects.ducking, offline, vocalGain);
      }
    }
    for (const [name, nodes] of offlineNodes) if (nodes.effects.deEsser) scheduleOfflineDeEsser(nodes.effects.deEsser, tracks[name], settings(name, 0).effects.deEsser);
    for (const [name, nodes] of offlineNodes) if (nodes.effects.gate) scheduleOfflineNoiseGate(nodes.effects.gate, tracks[name], settings(name, 0).effects.gate, offline);
    // Schedule keyframed faders and processors on the same offline timeline as playback.
    for (const [name, nodes] of offlineNodes) {
      const lanes = automationByTrack[name]?.lanes || {};
      if (lanes.volume?.length && bufferDuration(tracks[name]) > 0.02) {
        const trackDuration = tracks[name].duration;
        const sampleCount = Math.min(120_001, Math.max(2, Math.ceil(trackDuration * 60) + 1));
        const curve = new Float32Array(sampleCount);
        const base = settings(name, 0);
        for (let index = 0; index < sampleCount; index += 1) {
          const time = trackDuration * index / (sampleCount - 1);
          curve[index] = base.muted ? 0 : settings(name, time).volume;
        }
        nodes.gain.gain.cancelScheduledValues(0);
        nodes.gain.gain.setValueCurveAtTime(curve, 0, trackDuration);
      }
      const keyframeTimes = [...new Set(Object.entries(lanes).filter(([key]) => key !== 'volume').flatMap(([, points]) => points.map(point => Math.max(0, Math.min(tracks[name].duration, point.time)))))].sort((a, b) => a - b);
      for (const time of keyframeTimes) updateTrackEffects(nodes, settings(name, time).effects, { currentTime: time }, 0);
    }
    status(t('status.rendering'));
    const rendered = await offline.startRendering();
    const result = await encodeWavInWorker(rendered, async peak => {
      if (peak < 0.98) return true;
      const peakDb = 20 * Math.log10(peak);
      const formattedPeak = new Intl.NumberFormat(getLanguage() === 'en' ? 'en-US' : 'fr-FR', { maximumFractionDigits: 1 }).format(peakDb);
      const dialogs = await getInteractionModal();
      return dialogs.confirm({ title: t('interaction.exportWarningTitle'), description: t('status.exportPeakWarning', { peak: formattedPeak }), acceptLabel: t('interaction.exportAnyway'), cancelLabel: t('interaction.cancel') });
    });
    if (result.cancelled) { status(t('status.exportCancelled')); return; }
    const url = URL.createObjectURL(result.blob), link = document.createElement('a');
    link.href = url; link.download = 'audiosplit-mix-stereo.wav'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(result.normalized ? t('status.exportedNormalized') : t('status.exported'));
  } catch (error) {
    console.error('Audio export failed.', error);
    status(error.message === t('status.exportMemoryLimit') || error.message === t('status.exportTooLarge') ? error.message : t('status.exportError'), true);
  } finally {
    button.disabled = !Object.keys(tracks).length;
  }
}
function bufferDuration(buffer) { return Number(buffer?.duration) || 0; }
$('#chooseButton').onclick = () => $('#fileInput').click();
const musicalKeys = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
function setupAnalysisKeyOptions() {
  const select = $('#analysisKey'), current = select.value;
  select.innerHTML = `<option value="">${t('analysis.unknown')}</option>${musicalKeys.flatMap(note => ['major', 'minor'].map(mode => `<option value="${note} ${mode}">${note} ${t(`analysis.${mode}`)}</option>`)).join('')}`;
  if (current) select.value = current;
}
function setAnalysisStatus(key, state = '') {
  currentAnalysisStatusKey = key;
  const target = $('#analysisStatus');
  target.textContent = t(key);
  target.dataset.state = state;
}
function confidenceLabel(value) {
  if (value >= 0.45) return t('analysis.confidenceHigh');
  if (value >= 0.2) return t('analysis.confidenceMedium');
  return t('analysis.confidenceLow');
}
function formatRate(value) { return `${(value / 1000).toFixed(value % 1000 ? 1 : 0)} kHz`; }
function updateAnalysisOrigins() {
  if (!currentMusicAnalysis) return;
  const bpm = Number($('#analysisBpm').value);
  const changedBpm = Number.isFinite(bpm) && bpm !== currentMusicAnalysis.bpm;
  $('#analysisBpmOrigin').textContent = changedBpm ? t('analysis.corrected') : `${t('analysis.estimated')} · ${confidenceLabel(currentMusicAnalysis.confidence)}`;
  const key = $('#analysisKey').value;
  const changedKey = key !== (currentMusicAnalysis.key || '');
  $('#analysisKeyOrigin').textContent = changedKey ? t('analysis.corrected') : `${t('analysis.estimated')} · ${confidenceLabel(currentMusicAnalysis.keyConfidence)}`;
}
function setTransformStatus(key, state = '') {
  const target = $('#transformStatus');
  target.textContent = key ? t(key) : '';
  target.dataset.state = state;
}
function pitchableTracks(names = Object.keys(tracks)) {
  return names.filter(name => !['vocals', 'drums'].includes(name) && Boolean(stemInfo[name]));
}
function defaultPitchTrack(names = Object.keys(tracks), preferred = null) {
  const available = pitchableTracks(names);
  if (available.includes(preferred)) return preferred;
  return ['other', 'accompaniment', 'bass'].find(name => available.includes(name)) || available[0] || '';
}
function syncPitchTrackOptions(preferred = currentMixTransform.pitchTrack) {
  const select = $('#transformPitchTrack');
  if (!select) return '';
  const available = pitchableTracks();
  const selected = defaultPitchTrack(available, preferred);
  const signature = available.join('|');
  if (select.dataset.trackOptions !== signature) {
    select.innerHTML = available.length
      ? available.map(name => `<option value="${name}">${t(stemInfo[name].titleKey)}</option>`).join('')
      : `<option value="">${t('transform.noPitchTracks')}</option>`;
    select.dataset.trackOptions = signature;
  }
  select.disabled = !available.length;
  select.value = selected;
  return selected;
}
function setTransformInputs(transform) {
  $('#transformSourceBpm').value = transform.sourceBpm ?? '';
  $('#transformTargetBpm').value = transform.targetBpm ?? transform.sourceBpm ?? '';
  $('#transformSemitones').value = String(transform.pitchSemitones ?? 0);
  syncPitchTrackOptions(transform.pitchTrack);
  $('#chooseKeyButton').textContent = `${t('transform.chooseKey')}${transform.targetKey ? ` · ${transform.targetKey}` : ''}`;
  syncTransformUi();
}
function readTransformInputs() {
  const sourceText = $('#transformSourceBpm').value.trim();
  const targetText = $('#transformTargetBpm').value.trim();
  const sourceBpm = sourceText ? Number(sourceText) : null;
  const targetBpm = targetText ? Number(targetText) : sourceBpm;
  const pitchSemitones = Number($('#transformSemitones').value);
  if (sourceBpm !== null && (!Number.isFinite(sourceBpm) || sourceBpm < 40 || sourceBpm > 240)) throw new Error(t('transform.sourceBpmMissing'));
  if (targetText && (!Number.isFinite(targetBpm) || targetBpm < 40 || targetBpm > 240)) throw new Error(t('transform.tempoRangeError'));
  if (sourceBpm === null && targetBpm !== null) throw new Error(t('transform.sourceBpmMissing'));
  const tempoRatio = sourceBpm !== null && targetBpm !== null ? targetBpm / sourceBpm : 1;
  if (tempoRatio < 0.5 || tempoRatio > 2) throw new Error(t('transform.tempoRangeError'));
  if (!Number.isInteger(pitchSemitones) || pitchSemitones < -12 || pitchSemitones > 12) throw new Error(t('transform.pitchRangeError'));
  const sourceKey = currentMixTransform.sourceKey || (currentJobId ? $('#analysisKey').value || currentMusicAnalysis?.key : null) || null;
  const pitchTrack = syncPitchTrackOptions($('#transformPitchTrack').value || currentMixTransform.pitchTrack);
  return { tempoRatio, pitchSemitones, pitchTrack, sourceBpm, targetBpm, sourceKey, targetKey: currentMixTransform.targetKey || null };
}
function sameRenderParameters(a, b) {
  return Math.abs(Number(a.tempoRatio || 1) - Number(b.tempoRatio || 1)) < 0.0001
    && Number(a.pitchSemitones || 0) === Number(b.pitchSemitones || 0)
    && (!(Number(a.pitchSemitones || 0) || Number(b.pitchSemitones || 0)) || (a.pitchTrack || '') === (b.pitchTrack || ''));
}
function sameTransform(a, b) {
  return sameRenderParameters(a, b) && (a.sourceBpm ?? null) === (b.sourceBpm ?? null)
    && (a.targetBpm ?? null) === (b.targetBpm ?? null);
}
function updateTransformSummary(transform) {
  const originalBpm = transform?.sourceBpm;
  const targetBpm = transform?.targetBpm ?? originalBpm;
  const pitch = Number(transform?.pitchSemitones || 0);
  const locale = getLanguage() === 'en' ? 'en-US' : 'fr-FR';
  const formatBpm = value => Number.isFinite(value) ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} BPM` : `— BPM`;
  const signedPitch = pitch > 0 ? `+${pitch}` : String(pitch);
  const sourceTonic = transform?.sourceKey ? ` · ${transform.sourceKey}` : '';
  const targetTonic = transform?.targetKey ? ` · ${transform.targetKey}` : '';
  const targetTrack = Number(transform?.pitchSemitones || 0) && transform?.pitchTrack && stemInfo[transform.pitchTrack]
    ? ` · ${t(stemInfo[transform.pitchTrack].titleKey)}` : '';
  const baseDuration = timelineDuration() / (Number(renderedTransform.tempoRatio) || 1);
  const resultDuration = Number.isFinite(baseDuration) ? baseDuration * (Number(transform?.tempoRatio) || 1) : 0;
  const durationLabel = seconds => seconds > 0 ? ` · ${formatTime(seconds)}` : '';
  $('#transformOriginalSummary').textContent = `${formatBpm(originalBpm)}${sourceTonic}${durationLabel(baseDuration)} · ${t('transform.semitonesValue', { value: 0 })}`;
  $('#transformResultSummary').textContent = `${formatBpm(targetBpm)}${targetTonic}${targetTrack}${durationLabel(resultDuration)} · ${t('transform.semitonesValue', { value: signedPitch })}`;
  const warning = $('#transformQualityWarning');
  const tempoChange = Math.abs(Number(transform?.tempoRatio || 1) - 1);
  const qualityMayDrop = Math.abs(pitch) >= 5 || tempoChange >= 0.1;
  warning.textContent = qualityMayDrop ? t('transform.qualityWarning') : '';
  warning.classList.toggle('hidden', !qualityMayDrop);
}
function syncTransformUi() {
  const panel = $('#transformPanel');
  if (!panel) return;
  const available = Object.keys(tracks).length > 0 && Boolean(currentJobId || activeProjectId);
  $('#transformOpenButton').disabled = !available;
  if (!available) transformModal?.close();
  syncPitchTrackOptions($('#transformPitchTrack')?.value || currentMixTransform.pitchTrack);
  panel.classList.toggle('hidden', !available);
  const mismatch = !sameRenderParameters(renderedTransform, currentMixTransform);
  $('#exportButton').disabled = !Object.keys(tracks).length || mismatch;
  try {
    const selected = readTransformInputs();
    updateTransformSummary(selected);
    if (transformBusy) return;
    if (sameTransform(selected, currentMixTransform) && !mismatch) setTransformStatus('transform.applied');
    else if (sameTransform(selected, renderedTransform)) setTransformStatus('transform.previewReady', 'preview');
    else setTransformStatus('transform.pending');
  } catch (error) {
    updateTransformSummary(null);
    if (!transformBusy) setTransformStatus(error.message, 'error');
  }
}
function decodedMemoryBytes(buffers) {
  return Object.values(buffers).reduce((total, buffer) => total + buffer.numberOfChannels * buffer.length * 4, 0);
}
async function renderTransform(transform, { startPreview = false } = {}) {
  if (transformBusy) return false;
  if (!currentJobId && !activeProjectId) throw new Error(t('transform.noSource'));
  transformBusy = true;
  setTransformStatus('transform.rendering');
  $('#previewTransformButton').disabled = true;
  $('#applyTransformButton').disabled = true;
  $('#resetTransformButton').disabled = true;
  const requestId = window.crypto?.randomUUID
    ? window.crypto.randomUUID().replaceAll('-', '')
    : Array.from(window.crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
  let progressTimer;
  const refreshProgress = async () => {
    try {
      const response = await fetch(`/api/transforms/progress/${requestId}`);
      if (!response.ok) return;
      const progress = await response.json();
      if (progress.status === 'rendering' && progress.total) {
        const target = $('#transformStatus');
        target.textContent = `${t('transform.rendering')} ${progress.completed}/${progress.total}`;
        target.dataset.state = '';
      }
    } catch { /* Progress is helpful but must never interrupt the render. */ }
  };
  try {
    const request = { tempoRatio: transform.tempoRatio, pitchSemitones: transform.pitchSemitones, language: getLanguage(), requestId };
    if (transform.pitchSemitones) request.pitchTargets = transform.pitchTrack ? [transform.pitchTrack] : [];
    if (activeProjectId) request.projectId = activeProjectId; else request.jobId = currentJobId;
    progressTimer = window.setInterval(refreshProgress, 500);
    void refreshProgress();
    const result = await apiJson('/api/transforms', { method: 'POST', body: JSON.stringify(request) });
    if (!result.cacheHit) setTransformStatus('transform.decoding');
    const names = Object.keys(result.stems);
    const oldMemory = decodedMemoryBytes(tracks);
    const rendered = {};
    for (const name of names) {
      const response = await fetch(result.stems[name]);
      if (!response.ok) throw new Error(t('transform.noSource'));
      const bytes = await response.arrayBuffer();
      if (oldMemory + decodedMemoryBytes(rendered) + bytes.byteLength * 2 > MAX_DECODED_STEM_BYTES) throw new Error(t('transform.memoryLimit'));
      rendered[name] = await getAudioContext().decodeAudioData(bytes);
    }
    const controls = snapshotTrackControls(Object.keys(tracks));
    const currentOffset = playing && !paused && audioCtx ? Math.max(0, audioCtx.currentTime - playStartedAt) : playheadOffset;
    const alignedOffset = currentOffset * (Number(renderedTransform.tempoRatio) || 1) / (Number(transform.tempoRatio) || 1);
    stop();
    Object.keys(rendered).forEach(name => {
      const oldDuration = tracks[name]?.duration || rendered[name].duration;
      const scale = rendered[name].duration / oldDuration;
      const curve = automationByTrack[name];
      if (curve?.points?.length) curve.points = curve.points.map(point => ({ ...point, time: point.time * scale }));
      if (curve?.lanes) Object.values(curve.lanes).forEach(points => points.forEach(point => { point.time *= scale; }));
    });
    Object.keys(tracks).forEach(name => delete tracks[name]);
    Object.entries(rendered).forEach(([name, buffer]) => { tracks[name] = buffer; });
    renderedTransform = { ...transform };
    renderTracks(names, controls);
    seekMix(alignedOffset, false);
    setTransportState();
    requestAnimationFrame(() => {
      names.forEach(name => drawWaveform(name, tracks[name]));
      names.forEach(refreshAutomation);
    });
    syncTransformUi();
    if (startPreview) {
      setTransformStatus('transform.previewReady', 'preview');
      await playMix();
    }
    return true;
  } finally {
    if (progressTimer) window.clearInterval(progressTimer);
    transformBusy = false;
    $('#previewTransformButton').disabled = false;
    $('#applyTransformButton').disabled = false;
    $('#resetTransformButton').disabled = false;
    syncTransformUi();
  }
}
async function previewTransform() {
  try { await renderTransform(readTransformInputs(), { startPreview: true }); }
  catch (error) { console.error('Audio preview transform failed.', error); setTransformStatus(error.message || t('transform.error'), 'error'); status(error.message || t('transform.error'), true); }
}
async function applyTransform() {
  try {
    const selected = readTransformInputs();
    if (!sameRenderParameters(selected, renderedTransform)) await renderTransform(selected);
    currentMixTransform = { ...selected };
    syncTransformUi();
    markProjectDirty();
    status(getLanguage() === 'en' ? 'Tempo applied to all tracks; pitch shift applied only to the selected track.' : 'Tempo appliqué à toutes les pistes ; tonalité modifiée uniquement sur la piste choisie.');
  } catch (error) { console.error('Audio transform failed.', error); setTransformStatus(error.message || t('transform.error'), 'error'); status(error.message || t('transform.error'), true); }
}
$('#transformSourceBpm').oninput = syncTransformUi;
$('#transformTargetBpm').oninput = syncTransformUi;
document.querySelectorAll('[data-tempo-factor]').forEach(button => button.onclick = () => {
  const source = Number($('#transformSourceBpm').value);
  if (!Number.isFinite(source) || source < 40 || source > 240) { setTransformStatus('transform.sourceBpmMissing', 'error'); $('#transformSourceBpm').focus(); return; }
  $('#transformTargetBpm').value = (source * Number(button.dataset.tempoFactor)).toFixed(1).replace(/\.0$/, '');
  syncTransformUi();
});
$('#transformSemitones').onchange = syncTransformUi;
$('#transformPitchTrack').onchange = syncTransformUi;
function normalizedKey(value) { return String(value || '').replace('♯', '#').trim(); }
function keySemitone(value) {
  const note = normalizedKey(value).split(/\s+/)[0];
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return notes.indexOf(note);
}
function chooseTargetKey(value) {
  if (!Object.keys(tracks).some(name => !['vocals', 'drums'].includes(name))) { status(t('key.noInstrumentTracks'), true); return false; }
  const sourceKey = currentMixTransform.sourceKey || (currentJobId ? $('#analysisKey').value || currentMusicAnalysis?.key : null);
  const sourceMode = String(sourceKey || '').toLowerCase().endsWith('minor') ? 'minor' : 'major';
  if (!String(value).toLowerCase().endsWith(sourceMode)) { status(t('key.modeMismatch'), true); return false; }
  const from = keySemitone(sourceKey), to = keySemitone(value);
  if (from < 0 || to < 0) { status(t('key.sourceMissing'), true); return false; }
  let shift = (to - from + 12) % 12;
  if (shift > 6) shift -= 12;
  currentMixTransform = { ...currentMixTransform, pitchSemitones: shift, sourceKey, targetKey: value };
  $('#transformSemitones').value = String(shift);
  setTransformInputs(currentMixTransform);
  void applyTransform();
  return true;
}
$('#previewTransformButton').onclick = () => void previewTransform();
$('#applyTransformButton').onclick = () => void applyTransform();
$('#resetTransformButton').onclick = () => {
  const sourceBpm = Number($('#transformSourceBpm').value) || null;
  $('#transformTargetBpm').value = sourceBpm ?? '';
  $('#transformSemitones').value = '0';
  currentMixTransform = { ...currentMixTransform, tempoRatio: 1, pitchSemitones: 0, targetBpm: sourceBpm, targetKey: currentMixTransform.sourceKey || null };
  setTransformInputs(currentMixTransform);
  void applyTransform();
};
function displayMusicAnalysis(result) {
  currentMusicAnalysis = result;
  $('#analysisDuration').textContent = formatDuration(result.duration);
  $('#analysisChannels').textContent = result.channels === 1 ? t('analysis.mono') : `${result.channels} ${t('analysis.channelsShort')}`;
  $('#analysisSampleRate').textContent = formatRate(result.sampleRate);
  $('#analysisBitDepth').textContent = result.bitDepth ? `${result.bitDepth} bits` : t('analysis.notAvailable');
  $('#analysisPeak').textContent = formatDbfs(result.peakDbfs);
  $('#analysisRms').textContent = formatDbfs(result.rmsDbfs);
  $('#analysisMeter').textContent = result.meter ? `${result.meter} · ${confidenceLabel(result.meterConfidence)}` : '—';
  $('#analysisBpm').value = result.bpm ?? '';
  $('#analysisBpm').disabled = false;
  setupAnalysisKeyOptions();
  $('#analysisKey').value = result.key || '';
  $('#analysisKey').disabled = false;
  updateAnalysisOrigins();
  setAnalysisStatus(result.confidence >= 0.2 && result.keyConfidence >= 0.05 ? 'analysis.complete' : 'analysis.lowConfidence', result.confidence >= 0.2 && result.keyConfidence >= 0.05 ? '' : 'uncertain');
}
$('#fileInput').onchange = async (event) => {
  const file = event.target.files[0];
  await analysisModalReady;
  const requestId = ++analysisRequestId;
  currentAnalysisFile = file || null;
  analysisPromise = Promise.resolve(null);
  currentMusicAnalysis = null;
  $('#analysisBpm').value = '';
  $('#analysisKey').value = '';
  $('#fileName').textContent = file ? file.name : '';
  $('#separateButton').disabled = !file;
  $('#analysisBpm').disabled = true;
  $('#analysisKey').disabled = true;
  if (file) {
    $('#analysisDuration').textContent = $('#analysisChannels').textContent = $('#analysisSampleRate').textContent = $('#analysisBitDepth').textContent = $('#analysisPeak').textContent = $('#analysisRms').textContent = $('#analysisMeter').textContent = '—';
    setAnalysisStatus('analysis.decoding');
    analysisPromise = (async () => {
      try {
        const result = await analyzeAudioFile(file, ensureAudioContext(), stage => {
          if (requestId === analysisRequestId) setAnalysisStatus(stage === 'decoding' ? 'analysis.decoding' : 'analysis.calculating');
        });
        if (requestId === analysisRequestId) displayMusicAnalysis(result);
        return result;
      } catch (error) {
        console.warn('Local music analysis could not complete.', error);
        if (requestId === analysisRequestId) {
          $('#analysisBpm').disabled = false;
          setupAnalysisKeyOptions();
          $('#analysisKey').disabled = false;
          setAnalysisStatus('analysis.error', 'error');
        }
        return null;
      }
    })();
    await analysisPromise;
  }
  status('');
};

async function separateAudio() {
  const file = $('#fileInput').files[0];
  if (!file) return;
  const fileAnalysisPromise = currentAnalysisFile === file ? analysisPromise : Promise.resolve(null);
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
  const engine = normalizeSeparationEngine($('#separationEngineSelect')?.value || getSavedSeparationEngine());
  if (cacheButton) cacheButton.disabled = true;
  separationCancelRequested = false;
  activeSeparationRequestId = window.crypto?.randomUUID
    ? window.crypto.randomUUID().replaceAll('-', '')
    : Array.from(window.crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
  const requestId = activeSeparationRequestId;
  cancelButton.disabled = false;
  cancelButton.classList.remove('hidden');
  startSeparationProgressPolling(requestId);
  const engineNames = { mdx: 'MDX', mdx_extra: 'MDX Extra', htdemucs: 'HTDemucs', htdemucs_ft: 'HTDemucs FT' };
  status(t('status.separatingEngine', { engine: engineNames[engine] }), false, true);
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
    status(getLanguage() === 'en' ? 'Loading separated tracks…' : 'Chargement des pistes séparées…', false, true);
    const names = Object.keys(data.stems);
    const decoded = [];
    for (const name of names) {
      const stemResponse = await fetch(`${data.stems[name]}?lang=${getLanguage()}`);
      if (!stemResponse.ok) throw Error(t('status.trackMissing', { track: t(stemInfo[name].titleKey) }));
      const bytes = await stemResponse.arrayBuffer();
      decoded.push([name, await getAudioContext().decodeAudioData(bytes)]);
    }

    // Keep the import screen quiet during separation; let the user review the
    // analysis only when the separated audio is ready to enter the Studio.
    await fileAnalysisPromise;
    const analysisAccepted = currentAnalysisFile === file && musicAnalysisModal
      ? await musicAnalysisModal.open()
      : false;

    currentJobId = data.jobId;
    currentSourceName = file.name;
    setPlaybackLabel(file.name.replace(/\.[^.]+$/, ''));
    currentMode = mode;
    currentEngine = engine;
    activeProjectId = null;
    updateStudioProjectButton();
    projectDirty = false;
    const detectedBpm = analysisAccepted ? Number($('#analysisBpm').value) : NaN;
    const sourceBpm = Number.isFinite(detectedBpm) && detectedBpm >= 40 && detectedBpm <= 240 ? detectedBpm : null;
    const sourceKey = analysisAccepted ? ($('#analysisKey').value || currentMusicAnalysis?.key || null) : null;
    currentMixTransform = { tempoRatio: 1, pitchSemitones: 0, pitchTrack: defaultPitchTrack(decoded.map(([name]) => name)), sourceBpm, targetBpm: sourceBpm, sourceKey, targetKey: sourceKey };
    renderedTransform = { ...currentMixTransform };
    setTransformInputs(currentMixTransform);
    if ($('#projectNameInput')) $('#projectNameInput').value = file.name.replace(/\.[^.]+$/, '');
    decoded.forEach(([name, buffer]) => {
      tracks[name] = buffer;
      ensureAutomation(name, buffer.duration);
    });
    renderTracks(names);
    setTransportState();
    $('#mixer').classList.remove('hidden');
    showAppPage('studio');
    syncTransformUi();
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
    if (cacheButton) cacheButton.disabled = false;
  }
}

$('#cancelSeparationButton').onclick = async () => {
  const button = $('#cancelSeparationButton'), requestId = activeSeparationRequestId;
  if (!requestId || button.disabled) return;
  button.disabled = true;
  try {
    await apiJson(`/api/separations/${requestId}/cancel?lang=${getLanguage()}`, { method: 'POST' });
    separationCancelRequested = true;
    status(t('status.canceling'), false, true);
  } catch (error) {
    console.error('Could not cancel separation.', error);
    button.disabled = false;
    status(userFacingError(error, 'status.cancelError'), true);
  }
};

async function clearAudioSplitCache() {
  const button = $('#clearCacheButton');
  if (button) button.disabled = true;
  try {
    const data = await apiJson(`/api/cache?lang=${getLanguage()}`, { method: 'DELETE' });
    const total = data.removedJobs + data.removedUploads;
    status(t('status.cacheCleared', { count: total, plural: total > 1 ? 's' : '' }));
  } catch (error) {
    console.error('AudioSplit cache could not be cleared.', error);
    status(userFacingError(error, 'status.actionError'), true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function confirmClearAudioSplitCache() {
  let confirmationText = t('cache.confirm').split('\n\n').slice(1).join('\n\n');
  try {
    const { storage = {} } = await apiJson('/api/library');
    const details = getLanguage() === 'en'
      ? `\n\nCurrent AudioSplit temporary data:\n• Previous separations: ${formatBytes(storage.jobBytes)}\n• Temporary imported audio copies: ${formatBytes(storage.uploadBytes)}\n• Total cache limit: ${formatBytes(storage.cacheLimitBytes)}\n\nSaved projects and mix presets (${formatBytes(storage.libraryBytes)}) will be kept.`
      : `\n\nDonnées temporaires AudioSplit actuelles :\n• Séparations déjà calculées : ${formatBytes(storage.jobBytes)}\n• Copies temporaires des musiques importées : ${formatBytes(storage.uploadBytes)}\n• Limite totale du cache : ${formatBytes(storage.cacheLimitBytes)}\n\nLes projets et préréglages enregistrés (${formatBytes(storage.libraryBytes)}) seront conservés.`;
    confirmationText += details;
  } catch (error) { console.warn('Could not read cache size before confirmation.', error); }
  const dialogs = await getInteractionModal();
  if (await dialogs.confirm({ title: t('cache.clear'), description: t('interaction.cacheDescription'), message: confirmationText, preserveLines: true, danger: true, acceptLabel: t('cache.clear') })) void clearAudioSplitCache();
}

$('#separateButton').onclick = () => { void separateAudio(); };
$('#playButton').onclick = () => { trackCutStart = null; void playMix(); };
$('#stopButton').onclick = () => { trackCutStart = null; stop(); };
$('#exportButton').onclick = exportMix;
function rememberActiveTrack(event) {
  const target = event.target instanceof Element ? event.target : null;
  const track = target?.closest('.track[data-track]');
  if (track && tracks[track.dataset.track]) activeTrackName = track.dataset.track;
}
document.addEventListener('pointermove', event => {
  lastPointerPosition = { x: event.clientX, y: event.clientY };
  rememberActiveTrack(event);
});
document.addEventListener('pointerdown', event => {
  lastPointerPosition = { x: event.clientX, y: event.clientY };
  rememberActiveTrack(event);
});
document.addEventListener('focusin', rememberActiveTrack);
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.repeat || event.key === 'Escape') return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  const action = getShortcutAction(event);
  if (!action) return;
  if (target?.closest('input, textarea, select, [contenteditable="true"], [role="slider"]')) return;
  if (action === 'playPause' && target?.closest('button, a') && !target.closest('#playButton, #stopButton')) return;
  if (document.querySelector('.fx-modal[aria-hidden="false"], .language-modal[aria-hidden="false"], .changelog-modal[aria-hidden="false"], .interaction-modal[aria-hidden="false"], .key-modal[aria-hidden="false"]')) return;
  if ($('#studioPage')?.classList.contains('hidden') || $('#mixer')?.classList.contains('hidden') || !Object.keys(tracks).length) return;

  if (action === 'vocalCut') {
    event.preventDefault();
    // Infer the active track from the pointer or the last track the user touched.
    if (!playing || paused || !audioCtx) { trackCutStart = null; return; }
    if (lastPointerPosition) rememberActiveTrack({ target: document.elementFromPoint(lastPointerPosition.x, lastPointerPosition.y) });
    const trackName = activeTrackName || (Object.keys(tracks).length === 1 ? Object.keys(tracks)[0] : null);
    if (!trackName) {
      trackCutStart = null;
      status(t('shortcuts.cutHoverRequired'));
      return;
    }
    const targetTrack = tracks[trackName];
    if (!targetTrack) {
      trackCutStart = null;
      status(t('shortcuts.cutTrackUnavailable', { track: t(stemInfo[trackName]?.titleKey || 'stem.vocals') }), true);
      return;
    }
    const duration = targetTrack.duration;
    const now = Math.max(0, Math.min(duration, audioCtx.currentTime - playStartedAt));
    if (trackCutStart === null || trackCutStart.track !== trackName) {
      trackCutStart = { time: now, track: trackName };
      document.querySelector(`[data-track="${trackName}"]`)?.classList.add('is-shortcut-cut-target');
      window.setTimeout(() => document.querySelector(`[data-track="${trackName}"]`)?.classList.remove('is-shortcut-cut-target'), 900);
      status(t('shortcuts.cutFirstPress', { track: t(stemInfo[trackName]?.titleKey || 'stem.vocals') }));
      return;
    }

    const start = trackCutStart.time;
    trackCutStart = null;
    const end = now;
    if (end - start < 0.06) { status(t('shortcuts.cutTooShort')); return; }

    const volumeInput = document.querySelector(`[data-control="${trackName}"][data-param="volume"]`);
    const automation = automationByTrack[trackName];
    if (!volumeInput || !automation) return;
    automation.lanes ||= {};
    const lane = automation.lanes.volume || [];
    const baseAtStart = automationValue(trackName, 'volume', start, Number(volumeInput.value));
    const baseAtEnd = automationValue(trackName, 'volume', end, Number(volumeInput.value));
    const fade = Math.min(0.045, (end - start) / 3);
    const cutPoints = [
      { time: start, value: baseAtStart },
      { time: start + fade, value: 0 },
      { time: end - fade, value: 0 },
      { time: end, value: baseAtEnd },
    ];
    automation.lanes.volume = lane.filter(point => point.time < start || point.time > end).concat(cutPoints).sort((a, b) => a.time - b.time);
    automation.activeLane = 'volume';
    automation.selected = automation.lanes.volume.indexOf(cutPoints[0]);
    refreshAutomation(trackName);
    markProjectDirty();
    document.querySelector(`[data-track="${trackName}"]`)?.classList.add('is-shortcut-cut-target');
    window.setTimeout(() => document.querySelector(`[data-track="${trackName}"]`)?.classList.remove('is-shortcut-cut-target'), 900);
    status(t('shortcuts.cutAppliedTrack', { track: t(stemInfo[trackName]?.titleKey || 'stem.vocals') }));
  } else if (action === 'playPause') {
    event.preventDefault();
    trackCutStart = null;
    void playMix();
  } else if (action === 'seekBack10' || action === 'seekForward10') {
    event.preventDefault();
    const now = playing && !paused && audioCtx ? Math.max(0, audioCtx.currentTime - playStartedAt) : playheadOffset;
    seekMix(now + (action === 'seekForward10' ? 10 : -10));
  } else if (action === 'seekBack30' || action === 'seekForward30') {
    event.preventDefault();
    const now = playing && !paused && audioCtx ? Math.max(0, audioCtx.currentTime - playStartedAt) : playheadOffset;
    seekMix(now + (action === 'seekForward30' ? 30 : -30));
  } else if (action === 'goToStart') {
    event.preventDefault();
    seekMix(0);
  } else if (action === 'goToEnd') {
    event.preventDefault();
    seekMix(timelineDuration());
  }
});
applyTranslations();
setTransportState();
// Modal HTML is loaded separately so individual dialogs can evolve independently.
async function initializeModalComponents() {
  try {
    await mountModalComponents($('#modalRoot'));
    enhanceStyledDropdowns($('#modalRoot'));
    applyTranslations();
    $('#analysisBpm').oninput = updateAnalysisOrigins;
    $('#analysisKey').onchange = updateAnalysisOrigins;
    musicAnalysisModal = createMusicAnalysisModal({
      validate: () => {
        const bpm = $('#analysisBpm');
        return !bpm.value || bpm.reportValidity();
      },
    });
    resolveAnalysisModalReady(musicAnalysisModal);
    $('#clearCacheButton').onclick = () => { void confirmClearAudioSplitCache(); };
    const separationEngineSelect = $('#separationEngineSelect');
    separationEngineSelect.value = getSavedSeparationEngine();
    separationEngineSelect.onchange = () => {
      try { localStorage.setItem('audiosplit.separationEngine', separationEngineSelect.value); }
      catch (error) { console.warn('Could not persist the separation model preference.', error); }
    };
    transformModal = createTransformModal($('#transformOpenButton'));
    fxModal = createFxModal({
      stemInfo,
      getSaturationTarget,
      getWidthTarget,
      getActiveEffects: (name) => automationByTrack[name]?.activeEffects || [],
    });
    setFxModal(fxModal);
    panCurvesModal = createPanCurveModal({
      getTrackLabel: name => t(stemInfo[name]?.titleKey || 'stem.accompaniment'),
      getActiveLane: name => automationByTrack[name]?.activeLane || 'pan',
      onApply: (name, preset, lane) => {
        const points = generateAutomationCurvePoints(name, preset, lane);
        if (!points || !automationByTrack[name]) return false;
        if (lane === 'pan') automationByTrack[name].points = points;
        else { automationByTrack[name].lanes ||= {}; automationByTrack[name].lanes[lane] = points; }
        automationByTrack[name].activeLane = lane;
        automationByTrack[name].selected = 0;
        refreshAutomation(name);
        markProjectDirty();
        status(t('panCurves.applied', { parameter: t(`automation.param.${lane}`) }));
        return true;
      },
    });
    setPanCurveModal(panCurvesModal);
    automationEffectModal = createAutomationEffectModal({
      getTrackLabel: name => t(stemInfo[name]?.titleKey || 'stem.accompaniment'),
      onRemove: (name, lane) => {
        if (removeTrackEffect(name, lane)) status(t('automation.effectRemoved'));
      },
    });
    setAutomationEffectModal(automationEffectModal);
    keyModal = createKeyModal($('#chooseKeyButton'), {
      getKeys: sourceKey => {
        const mode = String(sourceKey || '').toLowerCase().endsWith('minor') ? 'minor' : 'major';
        return musicalKeys.flatMap(note => ['major', 'minor'].map(keyMode => ({ value: `${note} ${keyMode}`, label: `${note} ${t(`analysis.${keyMode}`)}`, disabled: !sourceKey || keyMode !== mode })));
      },
      getAllKeys: () => musicalKeys.flatMap(note => ['major', 'minor'].map(mode => ({ value: `${note} ${mode}`, label: `${note} ${t(`analysis.${mode}`)}` }))),
      getSourceKey: () => currentMixTransform.sourceKey || (currentJobId ? $('#analysisKey').value || currentMusicAnalysis?.key : null),
      onSourceChoose: sourceKey => { currentMixTransform = { ...currentMixTransform, sourceKey, targetKey: sourceKey, pitchSemitones: 0 }; $('#transformSemitones').value = '0'; setTransformInputs(currentMixTransform); markProjectDirty(); },
      getCurrentKey: () => currentMixTransform.targetKey,
      onChoose: chooseTargetKey,
    });
    changelogModal = createChangelogModal($('#versionButton'));
    languageModal = createLanguageModal($('#languageButton'));
    shortcutsModal = createShortcutsModal($('#shortcutsButton'));
    settingsModal = createSettingsModal($('#settingsButton'));
    createReleaseDetailsModal($('#releaseDetailsButton'));
    interactionModal = createInteractionModal();
    resolveInteractionModalReady(interactionModal);
    $('#libraryButton').textContent = getLanguage() === 'en' ? 'Projects' : 'Projets';
    $('#projectsBackButton').onclick = () => showAppPage('home');
    $('#projectsBackButton').onclick = () => showAppPage('home');
    $('#projectNameInput').value = currentSourceName.replace(/\.[^.]+$/, '');
    $('#projectNameInput').oninput = () => {
      markProjectDirty();
      setPlaybackLabel($('#projectNameInput').value.trim() || currentSourceName.replace(/\.[^.]+$/, ''));
    };
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
        const imported = await apiJson(`/api/library/folders/${folderId}/projects/import`, { method: 'POST', body: form });
        selectedFolderId = folderId;
        await refreshLibrary();
        status(imported.renamed ? libraryLabels().importedDuplicate(imported.name) : libraryLabels().imported);
      } catch (error) {
        console.error('Project archive import failed.', error);
        status(libraryLabels().importError, true);
      } finally {
        $('#importProjectButton').disabled = false;
        event.target.value = '';
      }
    };
    $('#saveProjectButton').onclick = () => void saveCurrentProject();
    $('#saveMixAsProjectButton').onclick = () => void openProjectSavePanel();
    $('#saveFolderSelect').onchange = event => { selectedFolderId = event.target.value || null; };
    $('#projectSearchInput').oninput = () => renderLibrary();
    $('#projectSortSelect').onchange = () => renderLibrary();
    bindPresetControls({ refreshLibrary, status, userFacingError, interactionModal });
    bindFxButtons();
    try { await refreshLibrary(); } catch (error) { console.info('Local project library is not available yet.', error); }
    showAppPage(location.hash.slice(1) || 'projects');
  } catch (error) {
    // A missing component should not block audio separation or mixing.
    console.error('Modal components could not be loaded.', error);
    resolveAnalysisModalReady(null);
    $('#versionButton').disabled = true;
  }
}
onLanguageChange(() => {
  enhanceStyledDropdowns(document);
  $('#libraryButton').textContent = getLanguage() === 'en' ? 'Projects' : 'Projets';
  setAnalysisStatus(currentAnalysisStatusKey, $('#analysisStatus').dataset.state || '');
  syncTransformUi();
  setupAnalysisKeyOptions();
  updateAnalysisOrigins();
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
window.addEventListener('hashchange', () => showAppPage(location.hash.slice(1), { updateHash: false }));
window.addEventListener('load', () => showAppPage(location.hash.slice(1) || 'projects'));
setInterval(() => {
  if (activeProjectId && projectDirty && !projectSaving) void saveCurrentProject({ automatic: true });
}, 10000);
window.addEventListener('beforeunload', (event) => {
  if ((activeProjectId && projectDirty) || (currentJobId && !activeProjectId)) {
    event.preventDefault();
    event.returnValue = '';
  }
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') { fxModal?.close(); changelogModal?.close(); languageModal?.close(); settingsModal?.close(); shortcutsModal?.close(); keyModal?.close(); panCurvesModal?.close(); interactionModal?.close(); transformModal?.close(); } });
window.addEventListener('resize',()=>Object.entries(tracks).forEach(([name, buffer])=>buffer&&drawWaveform(name,buffer)));
