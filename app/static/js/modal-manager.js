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

// Render a conventional horizontal control for effects that do not need a fader.
function controlMarkup(key, label, value, min, max, step = 1) {
  return `<label class="fx-control"><span>${label}</span><output data-effect-output="${key}">${value}</output><input data-effect-input="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}"></label>`;
}

function effectCard(title, description, controls) {
  return `<article class="fx-effect-card"><h3>${title}</h3><p>${description}</p><div class="fx-control-grid">${controls}</div></article>`;
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
    const values = getValues(name);
    const cards = [];
    title.textContent = `Fx — ${info.title}`;

    // EQ and filters are useful for every stem, so they are always available.
    cards.push(effectCard('Égaliseur 3 bandes', 'Ajustez rapidement la couleur de la piste.', [
      controlMarkup('eqLow', 'Graves', values.eqLow, -12, 12),
      controlMarkup('eqMid', 'Médiums', values.eqMid, -12, 12),
      controlMarkup('eqHigh', 'Aigus', values.eqHigh, -12, 12),
    ].join('')));
    cards.push(effectCard('Filtres', 'Retirez les graves ou les aigus rapidement.', [
      controlMarkup('highPass', 'Passe-haut', values.highPass, 0, 100),
      controlMarkup('lowPass', 'Passe-bas', values.lowPass, 0, 100),
    ].join('')));

    if (['vocals', 'bass'].includes(name)) cards.push(effectCard('Compresseur', 'Stabilise les écarts de niveau.', controlMarkup('compressor', 'Compression', values.compressor, 0, 100)));
    if (name === 'vocals') {
      cards.push(effectCard('Reverb', 'Ajoute de l’espace à la voix.', controlMarkup('reverb', 'Mix', values.reverb, 0, 100)));
      cards.push(effectCard('Delay', 'Ajoute un écho rythmique à la voix.', controlMarkup('delay', 'Mix', values.delay, 0, 100)));
    }
    if (name === getWidthTarget()) cards.push(effectCard('Stéréo width', '100 garde la largeur originale.', controlMarkup('width', 'Largeur', values.width, 0, 200)));
    if (name !== 'vocals') cards.push(effectCard('Ducking voix', 'Baisse cette piste lorsque la voix chante.', controlMarkup('ducking', 'Ducking', values.ducking, 0, 100)));
    if (name === getSaturationTarget()) cards.push(`<article class="fx-effect-card fx-saturation-card"><div class="fx-effect-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15c2-7 4 7 6 0s4-7 6 0 3 0 4-3"/></svg></div><div class="fx-effect-copy"><p class="eyebrow">EFFET BASSE</p><h3>Saturation basse</h3><p>Ajoute du grain aux graves sans monter le volume.</p></div><div class="fx-saturation-fader" title="Saturation basse"><div class="fx-gauge" style="--level:${values.saturation}%"><i></i><input data-effect-input="saturation" type="range" min="0" max="100" value="${values.saturation}" aria-label="Saturation basse"></div><output data-effect-output="saturation">${values.saturation}</output></div></article>`);

    content.innerHTML = `<div class="fx-effect-grid">${cards.join('')}</div>`;
    content.querySelectorAll('[data-effect-input]').forEach((input) => {
      input.oninput = (event) => {
        const key = event.currentTarget.dataset.effectInput;
        const value = Number(event.currentTarget.value);
        setValue(name, key, value);
        content.querySelectorAll(`[data-effect-output="${key}"]`).forEach(output => { output.textContent = value; });
        if (key === 'saturation') content.querySelector('.fx-gauge').style.setProperty('--level', `${value}%`);
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
