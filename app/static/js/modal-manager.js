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
  const [fxModal, changelogModal] = await Promise.all([
    loadComponent('fx-modal.html'),
    loadComponent('changelog-modal.html'),
  ]);
  root.innerHTML = `${fxModal}${changelogModal}`;
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

/**
 * Create the first modular Fx controller. Track state remains in app.js,
 * while this component only renders the saturation control and returns edits.
 */
export function createFxModal({ stemInfo, getSaturationTarget, getValues, setValue }) {
  const modal = document.querySelector('#fxModal');
  const animated = createAnimatedModal(modal, '.fx-close');
  const title = modal.querySelector('#fxModalTitle');
  const content = modal.querySelector('#fxModalContent');

  const open = (name) => {
    const info = stemInfo[name];
    const values = getValues(name);
    title.textContent = `Fx — ${info.title}`;
    if (name === getSaturationTarget()) {
      content.innerHTML = `<article class="fx-effect-card fx-saturation-card"><div class="fx-effect-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15c2-7 4 7 6 0s4-7 6 0 3 0 4-3"/></svg></div><div class="fx-effect-copy"><p class="eyebrow">EFFET BASSE</p><h3>Saturation basse</h3><p>Ajoute du grain aux graves sans monter le volume.</p></div><div class="fx-saturation-fader" title="Saturation basse"><div class="fx-gauge" style="--level:${values.saturation}%"><i></i><input data-effect-input="saturation" type="range" min="0" max="100" value="${values.saturation}" aria-label="Saturation basse"></div><output data-effect-output="saturation">${values.saturation}</output></div></article>`;
      content.querySelector('[data-effect-input="saturation"]').oninput = (event) => {
        const value = Number(event.currentTarget.value);
        setValue(name, 'saturation', value);
        content.querySelector('[data-effect-output="saturation"]').textContent = value;
        content.querySelector('.fx-gauge').style.setProperty('--level', `${value}%`);
      };
    } else {
      const target = stemInfo[getSaturationTarget()];
      content.innerHTML = `<div class="fx-empty-state"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/></svg><h3>Aucun effet sur cette piste</h3><p>La saturation basse est disponible uniquement sur <span>${target.title.toLowerCase()}</span> pour cette séparation.</p></div>`;
    }

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
