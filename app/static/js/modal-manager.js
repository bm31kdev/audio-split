import { getLanguage, setLanguage, t } from './i18n.js?v=1.2.1';

// Modal markup is stored as HTML components. This module loads those components
// once and owns their open/close animation and keyboard-friendly focus behavior.

const componentPath = (name) => new URL(`../components/${name}`, import.meta.url);

/** Load a static HTML component and fail early if a resource is missing. */
async function loadComponent(name) {
  const response = await fetch(componentPath(name));
  if (!response.ok) throw new Error(`Unable to load ${name}.`);
  return response.text();
}

/** Mount every modal in one shared root to keep index.html intentionally small. */
export async function mountModalComponents(root) {
  const [fxModal, changelogModal, languageModal] = await Promise.all([
    loadComponent('fx-modal.html'),
    loadComponent('changelog-modal.html'),
    loadComponent('language-modal.html'),
  ]);
  root.innerHTML = `${fxModal}${changelogModal}${languageModal}`;
}

/**
 * Reusable modal animation helper. It keeps the dialog visible during its
 * closing transition instead of immediately removing it from the page.
 */
function createAnimatedModal(modal, closeSelector, returnFocus) {
  let closeTimer;

  const close = () => {
    if (modal.getAttribute('aria-hidden') === 'true') return;
    modal.classList.remove('is-open');
    closeTimer = setTimeout(() => modal.setAttribute('aria-hidden', 'true'), 240);
    returnFocus?.focus();
  };

  const show = () => {
    clearTimeout(closeTimer);
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => modal.classList.add('is-open'));
    modal.querySelector(closeSelector).focus();
  };

  modal.querySelectorAll('[data-modal-close]').forEach(button => { button.onclick = close; });
  return { close, show };
}

// Render a compact control: its accessible name remains available without a visible label.
function controlMarkup(key, labelKey, value, min, max, step = 1) {
  const label = t(labelKey);
  return `<label class="fx-control" title="${label}"><input data-effect-input="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}"><output data-effect-output="${key}">${value}</output></label>`;
}

function effectCard(titleKey, descriptionKey, controls) {
  return `<article class="fx-effect-card"><h3>${t(titleKey)}</h3><p>${t(descriptionKey)}</p><div class="fx-control-grid">${controls}</div></article>`;
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
    const cards = [];
    title.textContent = t('fx.title', { track: trackName });

    // EQ and filters are useful for every stem, so they are always available.
    cards.push(effectCard('fx.eq.title', 'fx.eq.description', [
      controlMarkup('eqLow', 'fx.low', values.eqLow, -12, 12),
      controlMarkup('eqMid', 'fx.mid', values.eqMid, -12, 12),
      controlMarkup('eqHigh', 'fx.high', values.eqHigh, -12, 12),
    ].join('')));
    cards.push(effectCard('fx.filters.title', 'fx.filters.description', [
      controlMarkup('highPass', 'fx.highPass', values.highPass, 0, 100),
      controlMarkup('lowPass', 'fx.lowPass', values.lowPass, 0, 100),
    ].join('')));

    if (['vocals', 'bass'].includes(name)) cards.push(effectCard('fx.compressor.title', 'fx.compressor.description', controlMarkup('compressor', 'fx.compression', values.compressor, 0, 100)));
    if (name === 'vocals') {
      cards.push(effectCard('fx.reverb.title', 'fx.reverb.description', controlMarkup('reverb', 'fx.mix', values.reverb, 0, 100)));
      cards.push(effectCard('fx.delay.title', 'fx.delay.description', controlMarkup('delay', 'fx.mix', values.delay, 0, 100)));
    }
    if (name === getWidthTarget()) cards.push(effectCard('fx.width.title', 'fx.width.description', controlMarkup('width', 'fx.width', values.width, 0, 200)));
    if (name !== 'vocals') cards.push(effectCard('fx.duck.title', 'fx.duck.description', controlMarkup('ducking', 'fx.duck', values.ducking, 0, 100)));
    if (name === getSaturationTarget()) cards.push(`<article class="fx-effect-card fx-saturation-card"><p class="eyebrow fx-bass-label">${t('fx.bass.label')}</p><h3>${t('fx.bass.title')}</h3><p>${t('fx.bass.description')}</p><div class="fx-control-grid">${controlMarkup('saturation', 'fx.bass.title', values.saturation, 0, 100)}</div></article>`);

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
