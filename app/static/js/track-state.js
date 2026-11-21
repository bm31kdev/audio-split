import { $, tracks, automationByTrack, effectDefaults, effectsByTrack, stemInfo, icon, speakerIcon, updateOutputs, markProjectDirty, updateLiveMix, bindAutomation, bindPlayheadSeeking, bindFxButtons, bindTrackTimelineZoom, setTrackTargets, ensureAutomation, refreshAutomation } from './audio-engine.js?v=1.5.0.77';
import { t } from './i18n.js?v=1.5.0.77';
import { lucideIcon } from './lucide.js?v=1.5.0.77';

export function snapshotTrackControls(names) {
  return Object.fromEntries(names.map((name) => {
    const volume = document.querySelector(`[data-control="${name}"][data-param="volume"]`);
    const pan = document.querySelector(`[data-control="${name}"][data-param="pan"]`);
    const mute = document.querySelector(`[data-mute="${name}"]`);
    const solo = document.querySelector(`[data-solo="${name}"]`);
    return [name, volume && pan && mute ? { volume: volume.value, pan: pan.value, muted: mute.getAttribute('aria-pressed') === 'true', solo: solo?.getAttribute('aria-pressed') === 'true' } : {}];
  }));
}
export function savePayload() {
  const names = Object.keys(tracks);
  const automation = Object.fromEntries(names.map(name => {
    const state = automationByTrack[name] || {};
    const points = Array.isArray(state.points)
      ? state.points.map(point => ({ time: Number(point.time), pan: Number(point.pan) }))
      : [];
    const lanes = Object.fromEntries(Object.entries(state.lanes || {}).map(([parameter, lanePoints]) => [
      parameter,
      Array.isArray(lanePoints)
        ? lanePoints.map(point => ({ time: Number(point.time), value: Number(point.value) }))
        : [],
    ]));
    const selected = Number.isInteger(state.selected) && state.selected >= 0 && state.selected < points.length
      ? state.selected
      : 0;
    return [name, {
      points,
      selected,
      lanes,
      activeLane: typeof state.activeLane === 'string' ? state.activeLane : 'pan',
      activeEffects: Array.isArray(state.activeEffects) ? [...new Set(state.activeEffects.filter(value => typeof value === 'string'))] : [],
    }];
  }));
  return {
    settings: snapshotTrackControls(names),
    effects: Object.fromEntries(names.map(name => [name, effectsByTrack[name] || { ...effectDefaults }])),
    automation,
  };
}
function syncSoloTrackStyles() {
  const soloTracks = new Set([...document.querySelectorAll('[data-solo][aria-pressed="true"]')].map(button => button.dataset.solo));
  document.querySelectorAll('[data-track]').forEach(track => {
    const isSolo = soloTracks.has(track.dataset.track);
    track.classList.toggle('is-solo-active', isSolo);
    track.classList.toggle('is-solo-muted', soloTracks.size > 0 && !isSolo);
  });
}
export function renderTracks(names, savedControls = {}) {
  // Detailed splits expose a bass stem; simple splits use accompaniment as the bass source.
  setTrackTargets(names.includes('bass'), names.includes('other'));
  names.forEach(name => { effectsByTrack[name] ??= { ...effectDefaults }; });
  $('#tracks').innerHTML = names.map((name) => {
    const info = stemInfo[name], trackTitle = t(info.titleKey), trackDetail = t(info.detailKey), saved = savedControls[name] || {};
    const volume = saved.volume ?? 100, pan = saved.pan ?? 0, muted = saved.muted ?? false, solo = saved.solo ?? false;
    const soloLabel = t(solo ? 'control.unsolo' : 'control.solo', { track: trackTitle });
    const muteLabel = t(muted ? 'control.unmute' : 'control.mute', { track: trackTitle });
    const automation = `<div class="automation-tools"><div class="automation-lanes" data-automation-lanes="${name}"></div><span class="automation-time" data-automation-time="${name}">0:00</span><button type="button" class="remove-point" data-automation-remove="${name}" title="${t('automation.remove')}" aria-label="${t('automation.remove')}">${lucideIcon('x', { size: 13 })}</button></div>`;
    return `<article class="track ${name}" data-track="${name}">
      <div class="track-icon">${icon(info.icon)}</div>
      <div class="track-title">
        <h3>${trackTitle}</h3><p>${trackDetail}</p>
        <div class="track-actions">
          <button type="button" class="track-solo" data-button-variant="primary" data-button-size="compact" data-solo="${name}" aria-pressed="${solo}" aria-label="${soloLabel}" title="${soloLabel}">${t('control.soloShort')}</button>
          <button type="button" class="track-reset" data-button-variant="primary" data-button-size="small-icon" data-track-reset="${name}" aria-label="${t('control.reset', { track: trackTitle })}" title="${t('control.reset', { track: trackTitle })}">${lucideIcon('rotate-ccw', { size: 17 })}</button>
        </div>
        <div class="track-meter" data-track-meter="${name}" role="meter" aria-label="${t('control.level', { track: trackTitle })}" aria-valuemin="-60" aria-valuemax="6" aria-valuenow="-60" aria-valuetext="−∞">
          <span class="track-meter-label">${t('control.levelShort')}</span><span class="track-meter-bar"><i data-track-meter-bar="${name}"></i></span><output data-track-meter-value="${name}">−∞</output>
        </div>
      </div>
      <button type="button" class="fx-button" data-button-variant="primary" data-button-size="fx" data-fx="${name}" aria-label="${t('fx.open', { track: trackTitle })}" title="${t('fx.open', { track: trackTitle })}">Fx</button>
      <div class="wave-area" title="${t('timeline.zoomHint')}"><div class="wave-content" data-wave-content="${name}"><canvas class="waveform" data-waveform="${name}" aria-label="${trackTitle}"></canvas><span class="playhead" data-playhead="${name}" role="slider" tabindex="0" aria-label="${t('playhead.label', { track: trackTitle })}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="0:00"></span>${automation}</div></div>
      <div class="track-quick-controls"><button class="mute" data-button-variant="primary" data-button-size="mute" data-mute="${name}" aria-pressed="${muted}" aria-label="${muteLabel}" title="${muteLabel}">${speakerIcon(muted)}</button><button type="button" class="mute pan-curves-trigger" data-button-variant="primary" data-button-size="mute" data-pan-curves="${name}" aria-label="${t('panCurves.open')}" title="${t('panCurves.open')}" hidden><svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17c4 0 4-10 9-10s5 10 9 10"/><path d="M3 12h18" opacity=".35"/></svg></button></div>
      <div class="track-state-inputs" hidden><input aria-label="${t('control.volume', { track: trackTitle })}" data-control="${name}" data-param="volume" type="range" min="0" max="150" value="${volume}"><output id="${name}VolumeOut">${volume}</output><input aria-label="${t('control.pan', { track: trackTitle })}" data-control="${name}" data-param="pan" type="range" min="-100" max="100" value="${pan}"><output id="${name}PanOut">${pan}</output></div>
    </article>`;
  }).join('');
  document.querySelectorAll('[data-control]').forEach(el => el.oninput = () => { updateOutputs(); markProjectDirty(); });
  document.querySelectorAll('[data-mute]').forEach(button => button.onclick = () => {
    const muted = button.getAttribute('aria-pressed') === 'true', nextMuted = !muted, name = button.dataset.mute;
    const label = t(nextMuted ? 'control.unmute' : 'control.mute', { track: t(stemInfo[name].titleKey) });
    button.setAttribute('aria-pressed', String(nextMuted)); button.setAttribute('aria-label', label); button.title = label; button.innerHTML = speakerIcon(nextMuted); updateLiveMix(); markProjectDirty();
  });
  document.querySelectorAll('[data-solo]').forEach(button => button.onclick = () => {
    const solo = button.getAttribute('aria-pressed') !== 'true', name = button.dataset.solo;
    const label = t(solo ? 'control.unsolo' : 'control.solo', { track: t(stemInfo[name].titleKey) });
    button.setAttribute('aria-pressed', String(solo)); button.setAttribute('aria-label', label); button.title = label; syncSoloTrackStyles(); updateLiveMix(); markProjectDirty();
  });
  document.querySelectorAll('[data-track-reset]').forEach(button => button.onclick = () => {
    const name = button.dataset.trackReset;
    const volume = document.querySelector(`[data-control="${name}"][data-param="volume"]`);
    const pan = document.querySelector(`[data-control="${name}"][data-param="pan"]`);
    const mute = document.querySelector(`[data-mute="${name}"]`);
    const solo = document.querySelector(`[data-solo="${name}"]`);
    if (!tracks[name] || !volume || !pan || !mute || !solo) return;

    // Restore every per-track mix setting, including automation and effect lanes.
    volume.value = '100'; pan.value = '0';
    mute.setAttribute('aria-pressed', 'false'); mute.innerHTML = speakerIcon(false);
    const title = t(stemInfo[name].titleKey), muteLabel = t('control.mute', { track: title }), soloLabel = t('control.solo', { track: title });
    mute.setAttribute('aria-label', muteLabel); mute.title = muteLabel;
    solo.setAttribute('aria-pressed', 'false');
    solo.setAttribute('aria-label', soloLabel); solo.title = soloLabel;
    effectsByTrack[name] = { ...effectDefaults };
    ensureAutomation(name, tracks[name].duration);
    syncSoloTrackStyles();
    updateOutputs();
    refreshAutomation(name);
    markProjectDirty();
  });
  bindAutomation();
  names.forEach(refreshAutomation);
  bindPlayheadSeeking();
  bindTrackTimelineZoom();
  bindFxButtons();
  updateOutputs();
  syncSoloTrackStyles();
}


// Stop all live nodes together because every stem starts at the same audio clock time.
