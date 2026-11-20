const STORAGE_KEY = 'audiosplit-keyboard-shortcuts';
const RESERVED_CODES = new Set(['Escape', 'Tab', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'Fn']);

export const SHORTCUT_DEFAULTS = Object.freeze({
  playPause: 'Space',
  seekBack10: 'ArrowLeft',
  seekForward10: 'ArrowRight',
  seekBack30: 'Shift+ArrowLeft',
  seekForward30: 'Shift+ArrowRight',
  goToStart: 'Home',
  goToEnd: 'End',
  vocalCut: 'KeyR',
});

const isValidBinding = value => typeof value === 'string' && /^(Shift\+)?[A-Za-z][A-Za-z0-9]*$/.test(value);
function readBindings() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { /* Use defaults if browser storage is unavailable or corrupt. */ }
  const bindings = Object.fromEntries(Object.entries(SHORTCUT_DEFAULTS).map(([action, fallback]) => [
    action,
    isValidBinding(stored?.[action]) ? stored[action] : fallback,
  ]));
  return new Set(Object.values(bindings)).size === Object.keys(SHORTCUT_DEFAULTS).length
    ? bindings
    : { ...SHORTCUT_DEFAULTS };
}

let bindings = readBindings();

function persistBindings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)); } catch { /* Keep bindings for this page session if storage is unavailable. */ }
  window.dispatchEvent(new CustomEvent('audiosplit:shortcuts-updated', { detail: getShortcutBindings() }));
}

export function getShortcutBindings() { return { ...bindings }; }

export function shortcutFromEvent(event) {
  if (!event.code || RESERVED_CODES.has(event.code) || event.ctrlKey || event.altKey || event.metaKey) return null;
  return `${event.shiftKey ? 'Shift+' : ''}${event.code}`;
}

export function getShortcutAction(event) {
  const binding = shortcutFromEvent(event);
  if (!binding) return null;
  return Object.keys(bindings).find(action => bindings[action] === binding) || null;
}

export function assignShortcut(action, binding) {
  if (!Object.hasOwn(SHORTCUT_DEFAULTS, action) || !isValidBinding(binding)) return { ok: false, reason: 'invalid' };
  const conflict = Object.keys(bindings).find(other => other !== action && bindings[other] === binding);
  if (conflict) return { ok: false, reason: 'duplicate', conflict };
  bindings = { ...bindings, [action]: binding };
  persistBindings();
  return { ok: true };
}

export function resetShortcuts() {
  bindings = { ...SHORTCUT_DEFAULTS };
  persistBindings();
  return getShortcutBindings();
}

export function formatShortcut(binding, language = 'fr') {
  if (!binding) return '';
  const [modifier, code] = binding.startsWith('Shift+') ? ['Shift', binding.slice(6)] : ['', binding];
  const names = {
    Space: language === 'en' ? 'Space' : 'Espace',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Home: language === 'en' ? 'Home' : 'Début',
    End: language === 'en' ? 'End' : 'Fin',
    Enter: language === 'en' ? 'Enter' : 'Entrée',
    Escape: 'Esc', Tab: 'Tab', Backspace: language === 'en' ? 'Backspace' : 'Retour',
    Delete: language === 'en' ? 'Delete' : 'Suppr',
  };
  let label = names[code];
  if (!label && /^Key[A-Z]$/.test(code)) label = code.slice(3);
  if (!label && /^Digit\d$/.test(code)) label = code.slice(5);
  if (!label && /^Numpad\d$/.test(code)) label = `Num ${code.slice(6)}`;
  if (!label) label = code;
  return modifier ? `${language === 'en' ? 'Shift' : 'Maj'} + ${label}` : label;
}
