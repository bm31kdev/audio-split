import { $, tracks, automationByTrack, effectDefaults, effectsByTrack, stemInfo, icon, speakerIcon, updateOutputs, markProjectDirty, updateLiveMix, bindAutomation, bindPlayheadSeeking, bindFxButtons, setTrackTargets, ensureAutomation, refreshAutomation } from './audio-engine.js?v=1.3.8.2';
import { t } from './i18n.js?v=1.3.8.2';

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
  return {
    settings: snapshotTrackControls(names),
    effects: Object.fromEntries(names.map(name => [name, effectsByTrack[name] || { ...effectDefaults }])),
    automation: Object.fromEntries(names.map(name => [name, automationByTrack[name] || { points: [], selected: 0 }])),
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
    const automation = `<div class="automation-tools"><span>${t('automation.pan', { track: trackTitle.toLowerCase() })}</span><span class="automation-time" data-automation-time="${name}">0:00</span><button type="button" data-button-variant="primary" data-automation-pan="${name}" data-pan="-100">${t('automation.left')}</button><button type="button" data-button-variant="primary" data-automation-pan="${name}" data-pan="0">${t('automation.center')}</button><button type="button" data-button-variant="primary" data-automation-pan="${name}" data-pan="100">${t('automation.right')}</button><button type="button" class="remove-point" data-button-variant="danger" data-automation-remove="${name}" title="${t('automation.remove')}">×</button></div>`;
    return `<article class="track ${name}" data-track="${name}">
      <div class="track-icon">${icon(info.icon)}</div>
      <div class="track-title">
        <h3>${trackTitle}</h3><p>${trackDetail}</p>
        <div class="track-actions">
          <button type="button" class="track-solo" data-button-variant="primary" data-button-size="compact" data-solo="${name}" aria-pressed="${solo}" aria-label="${soloLabel}" title="${soloLabel}">${t('control.soloShort')}</button>
          <button type="button" class="track-reset" data-button-variant="primary" data-button-size="small-icon" data-track-reset="${name}" aria-label="${t('control.reset', { track: trackTitle })}" title="${t('control.reset', { track: trackTitle })}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8m0-5v5h5"/></svg></button>
        </div>
        <div class="track-meter" data-track-meter="${name}" role="meter" aria-label="${t('control.level', { track: trackTitle })}" aria-valuemin="-60" aria-valuemax="6" aria-valuenow="-60" aria-valuetext="−∞">
          <span class="track-meter-label">${t('control.levelShort')}</span><span class="track-meter-bar"><i data-track-meter-bar="${name}"></i></span><output data-track-meter-value="${name}">−∞</output>
        </div>
      </div>
      <button type="button" class="fx-button" data-button-variant="primary" data-button-size="fx" data-fx="${name}" aria-label="${t('fx.open', { track: trackTitle })}" title="${t('fx.open', { track: trackTitle })}">Fx</button>
      <div class="pan-fader" title="${t('control.panTitle')}"><span class="pan-letter">L</span><div class="gauge pan-gauge"><i></i><input aria-label="${t('control.pan', { track: trackTitle })}" data-control="${name}" data-param="pan" type="range" min="-100" max="100" value="${pan}"></div><output id="${name}PanOut">${pan}</output><span class="pan-letter">R</span></div>
      <div class="wave-area"><canvas class="waveform" data-waveform="${name}" aria-label="${trackTitle}"></canvas><span class="playhead" data-playhead="${name}" role="slider" tabindex="0" aria-label="${t('playhead.label', { track: trackTitle })}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="0:00"></span>${automation}</div>
      <div class="volume-stack"><button class="mute" data-button-variant="primary" data-button-size="mute" data-mute="${name}" aria-pressed="${muted}" aria-label="${muteLabel}" title="${muteLabel}">${speakerIcon(muted)}</button><div class="volume-fader" title="${t('control.volumeTitle')}"><div class="gauge volume-gauge"><i></i><input aria-label="${t('control.volume', { track: trackTitle })}" data-control="${name}" data-param="volume" type="range" min="0" max="150" value="${volume}"></div><output id="${name}VolumeOut">${volume}</output></div></div>
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
    volume.value = '100'; pan.value = '0';
    mute.setAttribute('aria-pressed', 'false'); mute.innerHTML = speakerIcon(false);
    const title = t(stemInfo[name].titleKey), muteLabel = t('control.mute', { track: title }), soloLabel = t('control.solo', { track: title });
    mute.setAttribute('aria-label', muteLabel); mute.title = muteLabel;
    solo.setAttribute('aria-pressed', 'false');
    solo.setAttribute('aria-label', soloLabel); solo.title = soloLabel;
    syncSoloTrackStyles();
    effectsByTrack[name] = { ...effectDefaults };
    ensureAutomation(name, tracks[name].duration);
    updateOutputs(); refreshAutomation(name); markProjectDirty();
  });
  bindAutomation();
  bindPlayheadSeeking();
  bindFxButtons();
  updateOutputs();
  syncSoloTrackStyles();
}


// Stop all live nodes together because every stem starts at the same audio clock time.
