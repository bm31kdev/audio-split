import { $, tracks, automationByTrack, effectDefaults, effectsByTrack, stemInfo, icon, speakerIcon, updateOutputs, markProjectDirty, updateLiveMix, bindAutomation, bindPlayheadSeeking, bindFxButtons, setTrackTargets } from './audio-engine.js?v=1.3.6.1';
import { t } from './i18n.js?v=1.3.6.1';

export function snapshotTrackControls(names) {
  return Object.fromEntries(names.map((name) => {
    const volume = document.querySelector(`[data-control="${name}"][data-param="volume"]`);
    const pan = document.querySelector(`[data-control="${name}"][data-param="pan"]`);
    const mute = document.querySelector(`[data-mute="${name}"]`);
    return [name, volume && pan && mute ? { volume: volume.value, pan: pan.value, muted: mute.getAttribute('aria-pressed') === 'true' } : {}];
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
export function renderTracks(names, savedControls = {}) {
  // Detailed splits expose a bass stem; simple splits use accompaniment as the bass source.
  setTrackTargets(names.includes('bass'), names.includes('other'));
  names.forEach(name => { effectsByTrack[name] ??= { ...effectDefaults }; });
  $('#tracks').innerHTML = names.map((name) => {
    const info = stemInfo[name], trackTitle = t(info.titleKey), trackDetail = t(info.detailKey), saved = savedControls[name] || {};
    const volume = saved.volume ?? 100, pan = saved.pan ?? 0, muted = saved.muted ?? false;
    const automation = `<div class="automation-tools"><span>${t('automation.pan', { track: trackTitle.toLowerCase() })}</span><span class="automation-time" data-automation-time="${name}">0:00</span><button type="button" data-button-variant="primary" data-automation-pan="${name}" data-pan="-100">${t('automation.left')}</button><button type="button" data-button-variant="primary" data-automation-pan="${name}" data-pan="0">${t('automation.center')}</button><button type="button" data-button-variant="primary" data-automation-pan="${name}" data-pan="100">${t('automation.right')}</button><button type="button" class="remove-point" data-button-variant="danger" data-automation-remove="${name}" title="${t('automation.remove')}">×</button></div>`;
    return `<article class="track ${name}"><div class="track-icon">${icon(info.icon)}</div><div class="track-title"><h3>${trackTitle}</h3><p>${trackDetail}</p></div><button type="button" class="fx-button" data-button-variant="primary" data-fx="${name}" title="${t('fx.open', { track: trackTitle })}">Fx</button><div class="pan-fader" title="${t('control.panTitle')}"><span class="pan-letter">L</span><div class="gauge pan-gauge"><i></i><input aria-label="${t('control.pan', { track: trackTitle })}" data-control="${name}" data-param="pan" type="range" min="-100" max="100" value="${pan}"></div><output id="${name}PanOut">${pan}</output><span class="pan-letter">R</span></div><div class="wave-area"><canvas class="waveform" data-waveform="${name}" aria-label="${trackTitle}"></canvas><span class="playhead" data-playhead="${name}" role="slider" tabindex="0" aria-label="${t('playhead.label', { track: trackTitle })}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="0:00"></span>${automation}</div><div class="volume-stack"><button class="mute" data-button-variant="primary" data-mute="${name}" aria-pressed="${muted}" title="${t('control.mute', { track: trackTitle })}">${speakerIcon(muted)}</button><div class="volume-fader" title="${t('control.volumeTitle')}"><div class="gauge volume-gauge"><i></i><input aria-label="${t('control.volume', { track: trackTitle })}" data-control="${name}" data-param="volume" type="range" min="0" max="150" value="${volume}"></div><output id="${name}VolumeOut">${volume}</output></div></div></article>`;
  }).join('');
  document.querySelectorAll('[data-control]').forEach(el => el.oninput = () => { updateOutputs(); markProjectDirty(); });
  document.querySelectorAll('[data-mute]').forEach(button => button.onclick = () => { const muted = button.getAttribute('aria-pressed') === 'true'; button.setAttribute('aria-pressed', String(!muted)); button.innerHTML = speakerIcon(!muted); updateLiveMix(); markProjectDirty(); });
  bindAutomation();
  bindPlayheadSeeking();
  bindFxButtons();
  updateOutputs();
}


// Stop all live nodes together because every stem starts at the same audio clock time.
