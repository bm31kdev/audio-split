const VARIANTS = new Set(['primary', 'secondary', 'danger', 'modal']);

function guessSize(button) {
  if (button.classList.contains('remove-point')) return 'tiny-icon';
  if (button.classList.contains('fx-button')) return 'fx';
  if (button.classList.contains('language-button')) return 'header-icon';
  if (button.matches('[data-language-choice]')) return 'choice';
  if (button.classList.contains('library-folder')) return 'folder';
  if (button.classList.contains('version-button')) return 'compact';
  if (button.closest('.transport')) return 'transport';
  if (button.classList.contains('mute')) return 'mute';
  if (button.matches('.changelog-close, .fx-close, .language-close')) return 'small-icon';
  if (button.closest('.library-folder-heading, .library-project')) return 'compact';
  return 'normal';
}

function guessVariant(button) {
  if (button.classList.contains('cancel-separation') || button.classList.contains('cache-button')
      || button.matches('[data-delete-folder], [data-delete-project], [data-automation-remove]')) return 'danger';
  if (button.closest('.modal, [class$="-modal"]')) return 'modal';
  return 'primary';
}

/** Apply the shared component to existing and dynamically rendered buttons. */
export function applyButtonStyles(root = document) {
  const buttons = [];
  if (root instanceof HTMLButtonElement) buttons.push(root);
  buttons.push(...root.querySelectorAll?.('button') || []);
  buttons.forEach((button) => {
    if (!button.dataset.buttonSize) button.dataset.buttonSize = guessSize(button);
    const requested = button.dataset.buttonVariant || guessVariant(button);
    const variant = VARIANTS.has(requested) ? requested : guessVariant(button);
    button.dataset.buttonVariant = variant;
    button.dataset.audioButton = '';
    button.classList.add('audio-button');
  });
}

/** Clone the shared template for buttons created by JavaScript. */
export function createButton({ label, variant = 'secondary', icon = '', title = '', onClick } = {}) {
  const template = document.querySelector('#audioSplitButtonTemplate');
  if (!template) throw new Error('The AudioSplit button component has not been mounted.');
  const button = template.content.firstElementChild.cloneNode(true);
  button.dataset.buttonVariant = VARIANTS.has(variant) ? variant : 'secondary';
  button.querySelector('[data-button-label]').textContent = label || '';
  const iconSlot = button.querySelector('[data-button-icon]');
  if (icon) { iconSlot.innerHTML = icon; iconSlot.hidden = false; }
  if (title) { button.title = title; button.setAttribute('aria-label', title); }
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

/** Load the shared template once, then keep all current and future buttons styled. */
export async function mountButtonComponent(root) {
  const response = await fetch(new URL('../components/button.html?v=1.3.5.1', import.meta.url));
  if (!response.ok) throw new Error('Unable to load the shared button component.');
  root.innerHTML = await response.text();
  applyButtonStyles(document);
  const observer = new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) applyButtonStyles(node);
    }));
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}
