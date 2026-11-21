import { getLanguage, onLanguageChange, setLanguage, t } from './i18n.js?v=1.5.0.72';
import { effectCatalog, effectIsAvailable } from './effects/catalog.js?v=1.5.0.72';
import { AUTOMATION_CURVE_PRESETS, generateCurveTemplatePoints } from './pan-curves.js?v=1.5.0.72';
import { assignShortcut, formatShortcut, getShortcutBindings, resetShortcuts, shortcutFromEvent } from './keyboard-shortcuts.js?v=1.5.0.72';

// Modal markup is stored as HTML components. This module loads those components
// once and owns their open/close animation and keyboard-friendly focus behavior.

// Modal fragments must share the module cache version, otherwise a browser can
// keep an older changelog even after index.html and app.js have been updated.
const componentPath = (name) => {
  const url = new URL(`../components/${name}`, import.meta.url);
  url.search = new URL(import.meta.url).search;
  return url;
};

/** Load a static HTML component and fail early if a resource is missing. */
async function loadComponent(name) {
  const response = await fetch(componentPath(name));
  if (!response.ok) throw new Error(`Unable to load ${name}.`);
  return response.text();
}

/** Mount every modal in one shared root to keep index.html intentionally small. */
export async function mountModalComponents(root) {
  const [fxModal, changelogModal, languageModal, libraryModal, interactionModal, keyModal, panCurvesModal, automationEffectModal, musicAnalysisModal, settingsModal, releaseDetailsModal, shortcutsModal] = await Promise.all([
    loadComponent('fx-modal.html'),
    loadComponent('changelog-modal.html'),
    loadComponent('language-modal.html'),
    loadComponent('library-modal.html'),
    loadComponent('interaction-modal.html'),
    loadComponent('key-modal.html'),
    loadComponent('pan-curves-modal.html'),
    loadComponent('automation-effect-modal.html'),
    loadComponent('music-analysis-modal.html'),
    loadComponent('settings-modal.html'),
    loadComponent('release-details-modal.html'),
    loadComponent('shortcuts-modal.html'),
  ]);
  root.innerHTML = `${fxModal}${changelogModal}${languageModal}${libraryModal}${interactionModal}${keyModal}${panCurvesModal}${automationEffectModal}${musicAnalysisModal}${settingsModal}${releaseDetailsModal}${shortcutsModal}`;
}

/**
 * Reusable modal animation helper. It keeps the dialog visible during its
 * closing transition instead of immediately removing it from the page.
 */
function createAnimatedModal(modal, closeSelector, returnFocus) {
  let closeTimer;
  let focusReturnTarget = returnFocus;

  const close = () => {
    if (modal.getAttribute('aria-hidden') === 'true') return;
    modal.classList.remove('is-open');
    closeTimer = setTimeout(() => {
      modal.setAttribute('aria-hidden', 'true');
      focusReturnTarget?.focus();
    }, 240);
  };

  const show = () => {
    focusReturnTarget = returnFocus || document.activeElement;
    clearTimeout(closeTimer);
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => modal.classList.add('is-open'));
    modal.querySelector(closeSelector).focus();
  };

  modal.querySelectorAll('[data-modal-close]').forEach(button => { button.onclick = close; });
  bindModalFocusTrap(modal);
  return { close, show };
}

function bindModalFocusTrap(modal) {
  modal.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')]
      .filter(element => element.getClientRects().length > 0);
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
}

/** Open the tempo and key controls in a focused, keyboard-accessible modal. */
export function createTransformModal(trigger) {
  const modal = document.querySelector('#transformModal');
  const animated = createAnimatedModal(modal, '.transform-close', trigger);
  trigger.onclick = animated.show;
  return { close: animated.close };
}

export function bindModalAccessibility(modal) { bindModalFocusTrap(modal); }

/** Create a reusable, localized replacement for native confirm and prompt dialogs. */
export function createInteractionModal() {
  const modal = document.querySelector('#interactionModal');
  const animated = createAnimatedModal(modal, '.interaction-close');
  const title = modal.querySelector('#interactionTitle');
  const description = modal.querySelector('#interactionDescription');
  const message = modal.querySelector('#interactionMessage');
  const inputGroup = modal.querySelector('#interactionInputGroup');
  const inputLabel = modal.querySelector('#interactionInputLabel');
  const input = modal.querySelector('#interactionInput');
  const exactHint = modal.querySelector('#interactionExactHint');
  const cancelButton = modal.querySelector('#interactionCancel');
  const acceptButton = modal.querySelector('#interactionAccept');
  let pendingResolve = null;
  let mode = 'confirm';
  let expectedValue = null;

  const finish = (value) => {
    if (!pendingResolve) return;
    const resolve = pendingResolve;
    pendingResolve = null;
    animated.close();
    resolve(value);
  };
  const updateInputState = () => {
    const value = input.value.trim();
    const exactMatch = expectedValue === null || value === expectedValue;
    acceptButton.disabled = mode === 'prompt' && (!value || !exactMatch);
    exactHint.classList.toggle('hidden', expectedValue === null || exactMatch);
  };

  const show = (options = {}) => new Promise(resolve => {
    if (pendingResolve) finish(mode === 'confirm' ? false : null);
    pendingResolve = resolve;
    mode = options.mode || 'confirm';
    expectedValue = typeof options.expectedValue === 'string' ? options.expectedValue : null;
    title.textContent = options.title || (getLanguage() === 'en' ? 'Confirm action' : 'Confirmer l’action');
    description.textContent = options.description || '';
    message.textContent = options.message || '';
    message.classList.toggle('hidden', !options.message);
    message.classList.toggle('has-preserved-lines', Boolean(options.preserveLines));
    inputGroup.classList.toggle('hidden', mode !== 'prompt');
    inputLabel.textContent = options.inputLabel || '';
    input.value = options.value || '';
    input.placeholder = options.placeholder || '';
    input.maxLength = Number(options.maxLength) || 120;
    exactHint.textContent = options.exactHint || t('interaction.exactHint');
    exactHint.classList.toggle('hidden', expectedValue === null);
    cancelButton.textContent = options.cancelLabel || t('interaction.cancel');
    cancelButton.classList.toggle('hidden', mode === 'alert');
    acceptButton.textContent = options.acceptLabel || (mode === 'alert' ? t('interaction.close') : t('interaction.confirm'));
    acceptButton.dataset.buttonVariant = options.danger ? 'danger' : 'primary';
    expectedValue = typeof options.expectedValue === 'string' ? options.expectedValue : null;
    acceptButton.onclick = () => finish(mode === 'prompt' ? input.value.trim() : true);
    cancelButton.onclick = () => finish(mode === 'confirm' ? false : null);
    updateInputState();
    input.oninput = updateInputState;
    animated.show();
    if (mode === 'prompt') requestAnimationFrame(() => { input.focus(); input.select(); });
  });

  modal.querySelectorAll('[data-interaction-cancel], .interaction-close').forEach(button => {
    button.onclick = () => finish(mode === 'confirm' ? false : null);
  });
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape' && pendingResolve) {
      event.preventDefault();
      finish(mode === 'confirm' ? false : null);
    } else if (event.key === 'Enter' && mode === 'prompt' && !acceptButton.disabled && document.activeElement === input) {
      event.preventDefault();
      finish(input.value.trim());
    }
  });

  return {
    confirm: options => show({ ...options, mode: 'confirm' }).then(value => value === true),
    prompt: options => show({ ...options, mode: 'prompt' }).then(value => typeof value === 'string' ? value : null),
    alert: options => show({ ...options, mode: 'alert' }).then(() => undefined),
    close: () => finish(mode === 'confirm' ? false : null),
  };
}

/** Edit a track's saved volume/effect points at the shared transport playhead. */
export function createAutomationModal({ stemInfo, getAutomation, getPlayhead, getDuration, getBaseValue, canAutomate, onChange }) {
  const modal = document.querySelector('#automationModal');
  const animated = createAnimatedModal(modal, '.automation-close');
  const title = modal.querySelector('#automationTitle');
  const select = modal.querySelector('#automationLaneSelect');
  const timeLabel = modal.querySelector('#automationPlayheadLabel');
  const list = modal.querySelector('#automationKeyframeList');
  const chart = modal.querySelector('#automationCurve');
  let activeTrack = null;
  let activeParam = 'volume';
  let selectedIndex = -1;
  let draggedPoint = null;
  let selectedTime = null;
  const ranges = {
    volume: [0, 150], saturation: [0, 100], bassBoost: [0, 100], compressor: [0, 100], eqLow: [-12, 12], eqMid: [-12, 12], eqHigh: [-12, 12],
    reverb: [0, 100], delay: [0, 100], highPass: [0, 100], lowPass: [0, 100], width: [0, 200], ducking: [0, 100], chorus: [0, 100], flanger: [0, 100], phaser: [0, 100], tremolo: [0, 100], bitcrusher: [0, 100], gate: [0, 100], deEsser: [0, 100], limiter: [0, 100], exciter: [0, 100],
  };
  const formatTime = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const render = () => {
    const state = getAutomation(activeTrack);
    const points = state.lanes?.[activeParam] || [];
    const time = selectedTime ?? getPlayhead();
    const [min, max] = ranges[activeParam];
    timeLabel.textContent = `${t('automation.playhead')} · ${formatTime(time)}`;
    list.innerHTML = points.map((point, index) => `<li class="automation-keyframe${index === selectedIndex ? ' active' : ''}"><button type="button" data-select-keyframe="${index}">${formatTime(point.time)} <strong>${point.value}</strong></button><button type="button" class="automation-remove" data-remove-keyframe="${index}" aria-label="${t('automation.removePoint')}">×</button></li>`).join('') || `<li class="automation-empty">${t('automation.noPoints')}</li>`;
    list.querySelectorAll('[data-select-keyframe]').forEach(button => button.onclick = () => {
      selectedIndex = Number(button.dataset.selectKeyframe);
      selectedTime = points[selectedIndex]?.time ?? null;
      render();
    });
    list.querySelectorAll('[data-remove-keyframe]').forEach(button => button.onclick = () => {
      const index = Number(button.dataset.removeKeyframe); points.splice(index, 1); selectedIndex = -1; onChange(activeTrack); render();
    });
    const width = Math.max(1, chart.clientWidth), height = Math.max(1, chart.clientHeight), ratio = window.devicePixelRatio || 1;
    chart.width = Math.round(width * ratio); chart.height = Math.round(height * ratio);
    const context = chart.getContext('2d'); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
    const padX = 12, padY = 10, plotWidth = width - padX * 2, plotHeight = height - padY * 2, duration = Math.max(0.01, getDuration(activeTrack));
    context.strokeStyle = '#303641'; context.lineWidth = 1;
    for (let row = 0; row < 3; row += 1) { const y = padY + plotHeight * row / 2; context.beginPath(); context.moveTo(padX, y); context.lineTo(width - padX, y); context.stroke(); }
    const valueY = pointValue => padY + plotHeight * (1 - (pointValue - min) / Math.max(0.001, max - min));
    const ordered = [...points].sort((a, b) => a.time - b.time);
    context.strokeStyle = ordered.length ? '#d7ff54' : '#727d59'; context.lineWidth = 2; context.beginPath();
    if (ordered.length) ordered.forEach((point, index) => { const x = padX + plotWidth * point.time / duration, y = valueY(point.value); if (!index) context.moveTo(x, y); else context.lineTo(x, y); });
    else { const y = valueY(getBaseValue(activeTrack, activeParam)); context.moveTo(padX, y); context.lineTo(width - padX, y); }
    context.stroke();
    ordered.forEach((point, index) => { const x = padX + plotWidth * point.time / duration, y = valueY(point.value); context.fillStyle = index === selectedIndex ? '#ffffff' : '#d7ff54'; context.beginPath(); context.arc(x, y, index === selectedIndex ? 5 : 4, 0, Math.PI * 2); context.fill(); });
    const cursorX = padX + plotWidth * Math.min(duration, time) / duration;
    context.strokeStyle = '#ffffff9c'; context.setLineDash([3, 3]); context.beginPath(); context.moveTo(cursorX, padY); context.lineTo(cursorX, height - padY); context.stroke(); context.setLineDash([]);
  };
  const open = name => {
    activeTrack = name; activeParam = 'volume'; selectedIndex = -1; selectedTime = null;
    const info = stemInfo[name];
    title.textContent = `${t('automation.title')} · ${t(info.titleKey)}`;
    const params = Object.keys(ranges).filter(param => param === 'volume' || canAutomate(name, param));
    select.innerHTML = params.map(param => `<option value="${param}">${t(`automation.param.${param}`)}</option>`).join('');
    activeParam = 'volume'; select.value = activeParam;
    render(); animated.show();
  };
  select.onchange = () => { activeParam = select.value; selectedIndex = -1; selectedTime = null; render(); };
  chart.addEventListener('pointerdown', event => {
    const state = getAutomation(activeTrack); state.lanes ||= {}; state.lanes[activeParam] ||= [];
    const points = state.lanes[activeParam];
    const rect = chart.getBoundingClientRect();
    const [min, max] = ranges[activeParam];
    const duration = Math.max(0.01, getDuration(activeTrack));
    const px = event.clientX - rect.left, py = event.clientY - rect.top;
    const plotWidth = rect.width - 24, plotHeight = rect.height - 20;
    const nearest = points.map((point, index) => ({ point, index, x: 12 + plotWidth * point.time / duration, y: 10 + plotHeight * (1 - (point.value - min) / Math.max(0.001, max - min)) })).sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py))[0];
    if (nearest && Math.hypot(nearest.x - px, nearest.y - py) <= 16) {
      draggedPoint = nearest.point; selectedIndex = nearest.index; selectedTime = draggedPoint.time;
    } else {
      const clampedTime = Math.max(0, Math.min(duration, (px - 12) / Math.max(1, plotWidth) * duration));
      const clampedValue = max - Math.max(0, Math.min(1, (py - 10) / Math.max(1, plotHeight))) * (max - min);
      if (!points.length && duration > 0.04) {
        const baseline = getBaseValue(activeTrack, activeParam);
        points.push({ time: 0, value: baseline }, { time: Math.round(duration * 100) / 100, value: baseline });
      }
      const point = { time: Math.round(clampedTime * 100) / 100, value: Math.round(clampedValue * 10) / 10 };
      const existing = points.findIndex(candidate => Math.abs(candidate.time - point.time) < 0.04);
      if (existing >= 0) { points[existing] = point; draggedPoint = point; }
      else { points.push(point); draggedPoint = point; }
      points.sort((a, b) => a.time - b.time); selectedIndex = points.indexOf(point); selectedTime = point.time;
      onChange(activeTrack);
    }
    chart.setPointerCapture(event.pointerId); event.preventDefault(); render();
  });
  chart.addEventListener('pointermove', event => {
    if (!draggedPoint) return;
    const rect = chart.getBoundingClientRect(), [min, max] = ranges[activeParam];
    const duration = getDuration(activeTrack), plotWidth = Math.max(1, rect.width - 24), plotHeight = Math.max(1, rect.height - 20);
    const points = getAutomation(activeTrack).lanes[activeParam];
    const proposedTime = Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left - 12) / plotWidth)) * duration * 100) / 100;
    const neighbors = points.filter(point => point !== draggedPoint).sort((a, b) => a.time - b.time);
    const before = neighbors.filter(point => point.time <= proposedTime).at(-1)?.time ?? 0;
    const after = neighbors.find(point => point.time > proposedTime)?.time ?? duration;
    const minTime = points.length > 1 ? before + 0.01 : 0, maxTime = points.length > 1 ? after - 0.01 : duration;
    draggedPoint.time = Math.max(minTime, Math.min(maxTime, proposedTime));
    selectedTime = draggedPoint.time;
    draggedPoint.value = Math.round((max - Math.max(0, Math.min(1, (event.clientY - rect.top - 10) / plotHeight)) * (max - min)) * 10) / 10;
    points.sort((a, b) => a.time - b.time); selectedIndex = points.indexOf(draggedPoint); onChange(activeTrack); render();
  });
  const stopDrag = event => { if (!draggedPoint) return; draggedPoint = null; try { chart.releasePointerCapture(event.pointerId); } catch {} };
  chart.addEventListener('pointerup', stopDrag); chart.addEventListener('pointercancel', stopDrag);
  return { open, refresh: () => { if (activeTrack && modal.getAttribute('aria-hidden') === 'false') render(); }, close: animated.close };
}

/** Pick one of the 24 common major/minor keys for all stems. */
export function createKeyModal(trigger, { getKeys, getCurrentKey, getSourceKey, getAllKeys, onSourceChoose, onChoose }) {
  const modal = document.querySelector('#keyModal');
  const animated = createAnimatedModal(modal, '.key-close', trigger);
  const options = modal.querySelector('#keyOptions');
  const sourceWrap = modal.querySelector('#keySourceWrap');
  const sourceSelect = modal.querySelector('#keySourceSelect');
  const open = () => {
    const renderOptions = () => {
      const current = getCurrentKey();
      const source = getSourceKey();
      sourceWrap.classList.toggle('hidden', Boolean(source));
      options.innerHTML = getKeys(source).map(key => `<button type="button" data-key-choice="${key.value}" class="${current === key.value ? 'active' : ''}" ${key.disabled || !source ? 'disabled' : ''}>${key.label}</button>`).join('');
      options.querySelectorAll('[data-key-choice]:not(:disabled)').forEach(button => button.onclick = () => { if (onChoose(button.dataset.keyChoice) !== false) animated.close(); });
    };
    sourceSelect.innerHTML = `<option value="">${t('analysis.unknown')}</option>${getAllKeys().map(key => `<option value="${key.value}">${key.label}</option>`).join('')}`;
    sourceSelect.value = getSourceKey() || '';
    sourceSelect.onchange = () => { if (sourceSelect.value) onSourceChoose(sourceSelect.value); renderOptions(); };
    renderOptions();
    animated.show();
  };
  trigger.onclick = open;
  return { open, close: animated.close };
}

// Render each effect as a card that can be placed directly on its track curve.
function effectCard(effect, track, alreadyApplied) {
  const dragHint = alreadyApplied ? `<span class="fx-effect-state is-applied">${t('fx.alreadyApplied')}</span>` : `<span class="fx-effect-state">${t('fx.drag')}</span>`;
  return `<article class="fx-effect-card${alreadyApplied ? ' is-applied' : ' is-draggable'}" ${alreadyApplied ? '' : `draggable="true" data-drag-effect="${effect.key}" data-drag-track="${track}" title="${t('fx.dragHint')}"`}>${dragHint}<div class="fx-effect-heading"><h3>${t(effect.title)}</h3></div><p>${t(effect.description)}</p></article>`;
}

/**
 * Create the Fx controller. The track/effect state belongs to app.js; this
 * module only renders controls and reports changes through callbacks.
 */
export function createFxModal({ stemInfo, getSaturationTarget, getWidthTarget, getActiveEffects }) {
  const modal = document.querySelector('#fxModal');
  const animated = createAnimatedModal(modal, '.fx-close');
  const title = modal.querySelector('#fxModalTitle');
  const content = modal.querySelector('#fxModalContent');
  document.addEventListener('dragend', () => modal.classList.remove('is-dragging-effect'));

  const open = (name) => {
    const info = stemInfo[name];
    const trackName = t(info.titleKey);
    title.textContent = t('fx.title', { track: trackName });
    const targets = { saturation: getSaturationTarget(), width: getWidthTarget() };
    const activeEffects = getActiveEffects(name);
    const cards = effectCatalog.filter(effect => effectIsAvailable(effect, name, targets)).map(effect => {
      const alreadyApplied = activeEffects.includes(effect.key);
      return effectCard(effect, name, alreadyApplied);
    });
    content.innerHTML = `<div class="fx-effect-grid">${cards.join('')}</div>`;
    content.querySelectorAll('[data-drag-effect]').forEach(card => card.addEventListener('dragstart', event => {
      event.dataTransfer.setData('application/x-audiosplit-effect', JSON.stringify({ track: card.dataset.dragTrack, effect: card.dataset.dragEffect }));
      event.dataTransfer.effectAllowed = 'copy';
      modal.classList.add('is-dragging-effect');
      animated.close();
    }));
    animated.show();
  };

  return { open, close: animated.close };
}

/** Show ready-made pan curves for the track whose automation control opened it. */
export function createPanCurveModal({ getTrackLabel, getActiveLane, onApply }) {
  const modal = document.querySelector('#panCurvesModal');
  const animated = createAnimatedModal(modal, '.pan-curves-close');
  const title = modal.querySelector('#panCurvesTitle');
  const description = modal.querySelector('.changelog-header p:last-child');
  const content = modal.querySelector('#panCurvesContent');
  let activeTrack = null;
  let activeLane = 'pan';
  document.addEventListener('dragend', () => modal.classList.remove('is-dragging-pan-curve'));

  const open = track => {
    activeTrack = track;
    activeLane = getActiveLane(track) || 'pan';
    title.textContent = `${t('panCurves.title')} · ${getTrackLabel(track)}`;
    description.textContent = t('panCurves.description', { parameter: t(`automation.param.${activeLane}`) });
    content.innerHTML = AUTOMATION_CURVE_PRESETS.filter(preset => !preset.panOnly || activeLane === 'pan').map(preset => {
      const points = generateCurveTemplatePoints(preset.id, 100);
      const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.time.toFixed(1)} ${(13 - point.pan * 0.1).toFixed(1)}`).join(' ');
      return `<article class="fx-effect-card is-draggable pan-curve-card" role="button" tabindex="0" draggable="true" data-pan-curve-preset="${preset.id}" title="${t('panCurves.dragHint')}"><span class="fx-effect-state">${t('panCurves.drag')}</span><div class="fx-effect-heading"><h3>${t(preset.titleKey)}</h3><svg class="pan-curve-preview" viewBox="0 0 100 26" aria-hidden="true"><path class="pan-curve-midline" d="M2 13H98"/><path class="pan-curve-line" d="${path}"/></svg></div><p>${t(preset.descriptionKey)}</p></article>`;
    }).join('');
    content.querySelectorAll('[data-pan-curve-preset]').forEach(card => {
      card.addEventListener('dragstart', event => {
        event.dataTransfer.setData('application/x-audiosplit-automation-curve', JSON.stringify({ track: activeTrack, preset: card.dataset.panCurvePreset, lane: activeLane }));
        event.dataTransfer.effectAllowed = 'copy';
        modal.classList.add('is-dragging-pan-curve');
        animated.close();
      });
      card.addEventListener('click', () => {
        if (onApply(activeTrack, card.dataset.panCurvePreset, activeLane) !== false) animated.close();
      });
      card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (onApply(activeTrack, card.dataset.panCurvePreset, activeLane) !== false) animated.close();
        }
      });
    });
    animated.show();
  };

  return { open, close: animated.close };
}

/** Confirm removal of an effect lane and all its automation on a track. */
export function createAutomationEffectModal({ getTrackLabel, onRemove }) {
  const modal = document.querySelector('#automationEffectModal');
  const animated = createAnimatedModal(modal, '.automation-effect-close');
  const title = modal.querySelector('#automationEffectTitle');
  const description = modal.querySelector('#automationEffectDescription');
  const removeButton = modal.querySelector('[data-automation-effect-action="remove"]');
  let activeTrack = null;
  let activeLane = null;

  const open = (track, lane) => {
    activeTrack = track;
    activeLane = lane;
    const parameter = t(`automation.param.${lane}`);
    title.textContent = t('automation.effectRemoveTitle');
    description.textContent = t('automation.effectRemoveConfirm', { effect: parameter, track: getTrackLabel(track) });
    removeButton.onclick = () => {
      onRemove(activeTrack, activeLane);
      animated.close();
    };
    animated.show();
  };

  return { open, close: animated.close };
}

/** Wait for the user to review the local music analysis before opening Studio. */
export function createMusicAnalysisModal({ validate = () => true } = {}) {
  const modal = document.querySelector('#musicAnalysisModal');
  const animated = createAnimatedModal(modal, '.music-analysis-close');
  const acceptButton = modal.querySelector('#acceptAnalysisButton');
  let resolveReview = null;

  const finish = accepted => {
    if (!resolveReview) return;
    const resolve = resolveReview;
    resolveReview = null;
    animated.close();
    resolve(accepted);
  };
  acceptButton.onclick = () => {
    if (validate() !== false) finish(true);
  };
  modal.addEventListener('click', event => {
    if (event.target.closest('[data-modal-close]')) finish(false);
  });

  const open = () => new Promise(resolve => {
    if (resolveReview) finish(false);
    resolveReview = resolve;
    animated.show();
  });
  return { open, close: () => finish(false) };
}

/** Create the version-history modal controlled by the fixed version badge. */
export function createChangelogModal(trigger) {
  const modal = document.querySelector('#changelogModal');
  const animated = createAnimatedModal(modal, '.changelog-close', trigger);
  const list = modal.querySelector('.release-list');
  const releases = [...list.querySelectorAll('.release')];
  releases.sort((a, b) => {
    const version = element => (element.dataset.version || '0.0').split('.').map(Number);
    const [aMajor, aMinor] = version(a), [bMajor, bMinor] = version(b);
    return bMajor - aMajor || bMinor - aMinor;
  });
  list.replaceChildren(...releases);
  trigger.onclick = animated.show;
  return { close: animated.close };
}

/** Create the compact language picker controlled by the globe button. */
export function createLanguageModal(trigger) {
  const modal = document.querySelector('#languageModal');
  const animated = createAnimatedModal(modal, '.language-close', trigger);
  const refresh = () => modal.querySelectorAll('[data-language-choice]').forEach((button) => {
    button.classList.toggle('active', button.dataset.languageChoice === getLanguage());
  });
  trigger.onclick = () => { refresh(); animated.show(); };
  modal.querySelectorAll('[data-language-choice]').forEach((button) => {
    button.onclick = () => { setLanguage(button.dataset.languageChoice); refresh(); animated.close(); };
  });
  return { close: animated.close };
}

/** Show the keyboard shortcut reference from the application header. */
export function createShortcutsModal(trigger) {
  const modal = document.querySelector('#shortcutsModal');
  const animated = createAnimatedModal(modal, '.shortcuts-close', trigger);
  const feedback = modal.querySelector('[data-shortcuts-feedback]');
  let listeningAction = null;
  const renderBindings = () => {
    const language = getLanguage();
    const bindings = getShortcutBindings();
    modal.querySelectorAll('[data-shortcut-bind]').forEach(button => {
      const action = button.dataset.shortcutBind;
      const label = formatShortcut(bindings[action], language);
      button.querySelector('[data-shortcut-value]').textContent = label;
      button.classList.toggle('is-listening', action === listeningAction);
      button.querySelector('span').textContent = action === listeningAction ? t('shortcuts.listening') : t('shortcuts.change');
      button.setAttribute('aria-label', `${t('shortcuts.change')}: ${label}`);
    });
  };
  modal.querySelectorAll('[data-shortcut-bind]').forEach(button => {
    button.onclick = () => {
      listeningAction = button.dataset.shortcutBind;
      feedback.textContent = t('shortcuts.listeningHint');
      renderBindings();
    };
  });
  modal.addEventListener('keydown', event => {
    if (!listeningAction) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      listeningAction = null;
      feedback.textContent = t('shortcuts.cancelled');
      renderBindings();
      return;
    }
    const binding = shortcutFromEvent(event);
    if (!binding || event.repeat) return;
    const result = assignShortcut(listeningAction, binding);
    if (!result.ok) {
      feedback.textContent = result.reason === 'duplicate' ? t('shortcuts.duplicate') : t('shortcuts.invalidKey');
      return;
    }
    listeningAction = null;
    feedback.textContent = t('shortcuts.saved');
    renderBindings();
  }, true);
  modal.querySelector('[data-shortcuts-reset]').onclick = () => {
    listeningAction = null;
    resetShortcuts();
    feedback.textContent = t('shortcuts.resetDone');
    renderBindings();
  };
  onLanguageChange(renderBindings);
  renderBindings();
  trigger.onclick = animated.show;
  return { close: animated.close };
}

/** Create the bilingual, intentionally empty settings dialog. */
export function createSettingsModal(trigger) {
  const modal = document.querySelector('#settingsModal');
  const animated = createAnimatedModal(modal, '.settings-close', trigger);
  trigger.onclick = animated.show;
  return { close: animated.close };
}

/** Open detailed 1.6.0 notes from the settings footer. */
export function createReleaseDetailsModal(trigger) {
  const modal = document.querySelector('#releaseDetailsModal');
  const animated = createAnimatedModal(modal, '.release-details-close', trigger);
  trigger.onclick = animated.show;
  return { open: animated.show, close: animated.close };
}
