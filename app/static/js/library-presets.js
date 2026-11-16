import { $, tracks, automationByTrack, effectDefaults, effectsByTrack, updateOutputs, updateLiveMix, refreshAutomation, markProjectDirty, apiJson } from './audio-engine.js?v=1.4.3';
import { savePayload, renderTracks } from './track-state.js?v=1.4.3';
import { getLanguage } from './i18n.js?v=1.4.3';

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

// Render local mix presets and bind their actions independently from project management.
export function renderPresets(presetData, { refreshLibrary, status, userFacingError }) {
  const workspace = $('#presetWorkspace');
  if (!workspace) return;
  workspace.innerHTML = presetData.length ? presetData.map(preset => `<article class="preset-card"><div><h4>${escapeHtml(preset.name)}</h4><p>${Object.keys(preset.settings || {}).length} ${getLanguage() === 'en' ? 'tracks · mixer settings only' : 'pistes · réglages du mix uniquement'}</p></div><div><button data-button-variant="modal" data-apply-preset="${preset.id}" type="button">${getLanguage() === 'en' ? 'Apply' : 'Appliquer'}</button><button data-button-variant="modal" data-export-preset="${preset.id}" type="button">${getLanguage() === 'en' ? 'Export' : 'Exporter'}</button><button data-button-variant="modal" data-rename-preset="${preset.id}" type="button">${getLanguage() === 'en' ? 'Rename' : 'Renommer'}</button><button data-button-variant="danger" data-delete-preset="${preset.id}" type="button">${getLanguage() === 'en' ? 'Delete' : 'Supprimer'}</button></div></article>`).join('') : `<p class="library-empty">${getLanguage() === 'en' ? 'No mix presets saved yet.' : 'Aucun préréglage de mix enregistré.'}</p>`;
  workspace.querySelectorAll('[data-apply-preset]').forEach(button => button.onclick = () => void applyMixPreset(presetData, button.dataset.applyPreset, status));
  workspace.querySelectorAll('[data-export-preset]').forEach(button => button.onclick = async () => {
    try {
      const preset = await apiJson(`/api/library/presets/${button.dataset.exportPreset}`);
      const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
      link.download = `${preset.name.replace(/[^a-z0-9_-]+/gi, '-')}.audiosplit-preset.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (error) { status(userFacingError(error, 'status.actionError'), true); }
  });
  workspace.querySelectorAll('[data-rename-preset]').forEach(button => button.onclick = () => {
    const preset = presetData.find(item => item.id === button.dataset.renamePreset);
    const name = window.prompt(getLanguage() === 'en' ? 'New name:' : 'Nouveau nom :', preset.name);
    if (name?.trim()) void apiJson(`/api/library/presets/${preset.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) }).then(refreshLibrary).catch(error => status(userFacingError(error, 'status.actionError'), true));
  });
  workspace.querySelectorAll('[data-delete-preset]').forEach(button => button.onclick = async () => {
    const preset = presetData.find(item => item.id === button.dataset.deletePreset);
    const confirmation = window.prompt(getLanguage() === 'en' ? 'Type the exact preset name to permanently delete it:' : 'Tapez le nom exact du préréglage pour le supprimer définitivement :');
    if (confirmation !== preset.name) return;
    try { await apiJson(`/api/library/presets/${preset.id}`, { method: 'DELETE', body: JSON.stringify({ confirmation }) }); await refreshLibrary(); }
    catch (error) { status(userFacingError(error, 'status.actionError'), true); }
  });
}

// Apply mixer settings and stretch pan curves proportionally to the current song duration.
async function applyMixPreset(presetData, presetId, status) {
  if (!Object.keys(tracks).length) { status(getLanguage() === 'en' ? 'Load or separate a project before applying a mix preset.' : 'Chargez ou séparez un projet avant d’appliquer un préréglage.', true); return; }
  const preset = presetData.find(item => item.id === presetId); if (!preset) return;
  const names = Object.keys(tracks);
  const state = Object.fromEntries(names.map(name => [name, { ...(preset.settings?.[name] || {}) }]));
  names.forEach(name => {
    effectsByTrack[name] = { ...effectDefaults, ...(preset.effects?.[name] || {}) };
    const saved = preset.automation?.[name];
    if (saved?.points?.length) {
      const duration = tracks[name].duration;
      const originalDuration = Number(preset.durations?.[name] || duration);
      const points = saved.points.map(point => ({ time: Math.max(0, Math.min(duration, point.time * duration / originalDuration)), pan: point.pan })).sort((a, b) => a.time - b.time);
      automationByTrack[name] = { points, selected: Math.min(saved.selected || 0, points.length - 1) };
    }
  });
  renderTracks(names, state); requestAnimationFrame(() => names.forEach(name => refreshAutomation(name)));
  updateOutputs(); updateLiveMix(); markProjectDirty();
  status(getLanguage() === 'en' ? 'Mix preset applied.' : 'Préréglage de mix appliqué.');
}

// Connect create/import actions once after the project-library dialog is mounted.
export function bindPresetControls({ refreshLibrary, status, userFacingError }) {
  $('#savePresetButton').onclick = async () => {
    if (!Object.keys(tracks).length) { status(getLanguage() === 'en' ? 'Load or separate a track before saving a mix preset.' : 'Chargez ou séparez un morceau avant d’enregistrer un préréglage.', true); return; }
    const name = window.prompt(getLanguage() === 'en' ? 'Preset name:' : 'Nom du préréglage :');
    if (!name?.trim()) return;
    const payload = savePayload();
    payload.name = name.trim(); payload.durations = Object.fromEntries(Object.entries(tracks).map(([stem, buffer]) => [stem, buffer.duration]));
    try { await apiJson('/api/library/presets', { method: 'POST', body: JSON.stringify(payload) }); await refreshLibrary(); status(getLanguage() === 'en' ? 'Mix preset saved locally.' : 'Préréglage enregistré localement.'); }
    catch (error) { status(userFacingError(error, 'status.actionError'), true); }
  };
  $('#importPresetButton').onclick = () => $('#presetFileInput').click();
  $('#presetFileInput').onchange = async event => {
    const file = event.target.files[0]; if (!file) return;
    try { const payload = JSON.parse(await file.text()); await apiJson('/api/library/presets/import', { method: 'POST', body: JSON.stringify(payload) }); await refreshLibrary(); status(getLanguage() === 'en' ? 'Mix preset imported.' : 'Préréglage importé.'); }
    catch (error) { status(userFacingError(error, 'status.actionError'), true); }
    finally { event.target.value = ''; }
  };
}
