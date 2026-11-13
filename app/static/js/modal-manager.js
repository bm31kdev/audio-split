import { getLanguage, setLanguage, t } from './i18n.js?v=1.3.4.4';
import { effectCatalog, effectIsAvailable, effectTrackNames } from './effects/catalog.js?v=1.3.4.4';

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
  const [fxModal, changelogModal, languageModal, libraryModal] = await Promise.all([
    loadComponent('fx-modal.html'),
    loadComponent('changelog-modal.html'),
    loadComponent('language-modal.html'),
    loadComponent('library-modal.html'),
  ]);
  root.innerHTML = `${fxModal}${changelogModal}${languageModal}${libraryModal}`;
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

export function bindModalAccessibility(modal) { bindModalFocusTrap(modal); }

// Render a compact control: its accessible name remains available without a visible label.
function controlMarkup(key, labelKey, value, min, max, step = 1) {
  const label = t(labelKey);
  return `<label class="fx-control" title="${label}"><input data-effect-input="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}"><output data-effect-output="${key}">${value}</output></label>`;
}

function effectCard(effect, controls, available, targets) {
  const scope = t('fx.availableOn', { tracks: effectTrackNames(effect, targets, t) });
  const saturationLabel = effect.key === 'saturation' ? `<p class="eyebrow fx-bass-label">${t('fx.bass.label')}</p>` : '';
  return `<article class="fx-effect-card${available ? '' : ' is-unavailable'}">${saturationLabel}<h3>${t(effect.title)}</h3><p>${t(effect.description)}</p><p class="fx-availability">${scope}</p>${available ? `<div class="fx-control-grid">${controls}</div>` : ''}</article>`;
}

/**
 * Create the Fx controller. The track/effect state belongs to app.js; this
 * module only renders controls and reports changes through callbacks.
 */
export function createFxModal({ stemInfo, getSaturationTarget, getWidthTarget, getValues, setValue }) {
  const modal = document.querySelector('#fxModal');
  const animated = createAnimatedModal(modal, '.fx-close');
  const title = modal.querySelector('#fxModalTitle');
  const content = modal.querySelector('#fxModalContent');

  const open = (name) => {
    const info = stemInfo[name];
    const trackName = t(info.titleKey);
    const values = getValues(name);
    title.textContent = t('fx.title', { track: trackName });
    const targets = { saturation: getSaturationTarget(), width: getWidthTarget() };
    const cards = effectCatalog.map(effect => {
      const available = effectIsAvailable(effect, name, targets);
      let controls = '';
      if (available && effect.key === 'eq') controls = [
        controlMarkup('eqLow', 'fx.low', values.eqLow, -12, 12),
        controlMarkup('eqMid', 'fx.mid', values.eqMid, -12, 12),
        controlMarkup('eqHigh', 'fx.high', values.eqHigh, -12, 12),
      ].join('');
      else if (available && effect.key === 'bassBoost') controls = controlMarkup('bassBoost', 'fx.bassBoost.amount', values.bassBoost, 0, 100);
      else if (available && effect.key === 'filters') controls = [
        controlMarkup('highPass', 'fx.highPass', values.highPass, 0, 100),
        controlMarkup('lowPass', 'fx.lowPass', values.lowPass, 0, 100),
      ].join('');
      else if (available) {
        const labelKey = { compressor: 'fx.compression', reverb: 'fx.mix', delay: 'fx.mix', width: 'fx.width', ducking: 'fx.duck', saturation: 'fx.amount', bassBoost: 'fx.bassBoost.amount' }[effect.key] || 'fx.amount';
        controls = controlMarkup(effect.key, labelKey, values[effect.key], effect.key === 'width' ? 0 : 0, effect.key === 'width' ? 200 : 100);
      }
      return effectCard(effect, controls, available, targets);
    });
    content.innerHTML = `<div class="fx-effect-grid">${cards.join('')}</div>`;
    content.querySelectorAll('[data-effect-input]').forEach((input) => {
      input.oninput = (event) => {
        const key = event.currentTarget.dataset.effectInput;
        const value = Number(event.currentTarget.value);
        setValue(name, key, value);
        content.querySelectorAll(`[data-effect-output="${key}"]`).forEach(output => { output.textContent = value; });
      };
    });

    animated.show();
  };

  return { open, close: animated.close };
}

/** Create the version-history modal controlled by the fixed version badge. */
export function createChangelogModal(trigger) {
  const modal = document.querySelector('#changelogModal');
  const animated = createAnimatedModal(modal, '.changelog-close', trigger);
  const list = modal.querySelector('.release-list');
  const releases = [...list.querySelectorAll('.release')];
  const groups = new Map([['1.3', []], ['1.2', []], ['1.1', []], ['1.0', []]]);
  releases.forEach((release) => {
    const version = release.querySelector('h3')?.textContent.match(/\d+\.\d+/)?.[0];
    if (groups.has(version)) groups.get(version).push(release);
  });
  list.replaceChildren();
  groups.forEach((items, version) => {
    if (!items.length) return;
    const heading = document.createElement('li');
    heading.className = 'release-group';
    heading.textContent = `Versions ${version}`;
    list.append(heading, ...items);
  });
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
