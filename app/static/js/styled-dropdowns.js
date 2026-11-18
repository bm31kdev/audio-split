// Shared custom dropdowns keep native select values in sync with the app logic.
const selectRecords = new WeakMap();
let activeRecord = null;
let nextDropdownId = 0;

const selectedOption = select => select.options[select.selectedIndex] || null;
const selectLabel = select => select.getAttribute('aria-label')
  || select.closest('label')?.querySelector('span')?.textContent.trim()
  || select.closest('label')?.childNodes[0]?.textContent?.trim()
  || 'Choisir une option';

function closeRecord(record, { restoreFocus = false } = {}) {
  if (!record?.menu.isConnected) return;
  record.menu.remove();
  record.trigger.setAttribute('aria-expanded', 'false');
  record.wrapper.classList.remove('is-open');
  if (activeRecord === record) activeRecord = null;
  if (restoreFocus) record.trigger.focus();
}

function closeAllDropdowns() {
  if (activeRecord) closeRecord(activeRecord);
}

function optionRows(record) {
  const { select, menu } = record;
  menu.replaceChildren();
  [...select.options].forEach((option, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'styled-dropdown-option';
    item.id = `${record.id}-option-${index}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(option === selectedOption(select)));
    item.disabled = option.disabled;
    item.textContent = option.textContent.trim();
    item.dataset.value = option.value;
    item.addEventListener('click', () => {
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      record.sync();
      closeRecord(record, { restoreFocus: true });
    });
    menu.append(item);
  });
  if (!menu.childElementCount) {
    const empty = document.createElement('div');
    empty.className = 'styled-dropdown-empty';
    empty.textContent = select.getAttribute('data-empty-label') || 'Aucune option';
    menu.append(empty);
  }
}

function positionMenu(record) {
  const rect = record.trigger.getBoundingClientRect();
  const gap = 6;
  const edge = 12;
  const below = window.innerHeight - rect.bottom - edge;
  const above = rect.top - edge;
  const openAbove = below < 180 && above > below;
  const available = Math.max(96, Math.min(320, (openAbove ? above : below) - gap));
  record.menu.style.left = `${Math.max(edge, Math.min(rect.left, window.innerWidth - rect.width - edge))}px`;
  record.menu.style.width = `${Math.min(rect.width, window.innerWidth - edge * 2)}px`;
  record.menu.style.maxHeight = `${available}px`;
  record.menu.style.top = openAbove ? 'auto' : `${rect.bottom + gap}px`;
  record.menu.style.bottom = openAbove ? `${window.innerHeight - rect.top + gap}px` : 'auto';
}

function openRecord(record, { focusSelected = false } = {}) {
  if (record.select.disabled || !record.select.options.length) return;
  if (activeRecord === record) { closeRecord(record); return; }
  closeAllDropdowns();
  optionRows(record);
  document.body.append(record.menu);
  activeRecord = record;
  record.wrapper.classList.add('is-open');
  record.trigger.setAttribute('aria-expanded', 'true');
  positionMenu(record);
  if (focusSelected) {
    const item = record.menu.querySelector('[aria-selected="true"]:not(:disabled)') || record.menu.querySelector('button:not(:disabled)');
    item?.focus();
  }
}

function syncRecord(record) {
  const option = selectedOption(record.select);
  const labelText = selectLabel(record.select);
  record.trigger.setAttribute('aria-label', labelText);
  record.menu.setAttribute('aria-label', labelText);
  record.trigger.textContent = '';
  const label = document.createElement('span');
  label.className = 'styled-dropdown-value';
  label.textContent = option?.textContent.trim() || record.select.getAttribute('data-placeholder') || '';
  const arrow = document.createElement('span');
  arrow.className = 'styled-dropdown-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.innerHTML = '<svg viewBox="0 0 16 16" focusable="false"><path d="m4 6 4 4 4-4"/></svg>';
  record.trigger.append(label, arrow);
  record.trigger.disabled = record.select.disabled;
  record.trigger.setAttribute('aria-disabled', String(record.select.disabled));
  if (record.menu.isConnected) {
    optionRows(record);
    positionMenu(record);
  }
}

function enhanceSelect(select) {
  if (!(select instanceof HTMLSelectElement) || select.dataset.styledDropdown === 'true' || !select.parentElement) return;
  const wrapper = document.createElement('span');
  wrapper.className = 'styled-select';
  const label = selectLabel(select);
  const id = `audio-dropdown-${++nextDropdownId}`;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'styled-dropdown-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', label);
  trigger.setAttribute('aria-controls', `${id}-listbox`);
  const menu = document.createElement('div');
  menu.id = `${id}-listbox`;
  menu.className = 'styled-dropdown-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', label);
  menu.dataset.owner = id;
  const wrapperParent = select.parentElement;
  wrapperParent.insertBefore(wrapper, select);
  wrapper.append(select, trigger);
  select.dataset.styledDropdown = 'true';
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const record = { select, wrapper, trigger, menu, id, sync: () => syncRecord(record) };
  selectRecords.set(select, record);
  trigger.addEventListener('click', () => openRecord(record));
  trigger.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      openRecord(record, { focusSelected: true });
    }
  });
  menu.addEventListener('keydown', event => {
    const items = [...menu.querySelectorAll('button:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); closeRecord(record, { restoreFocus: true }); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + delta + items.length) % items.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      (event.key === 'Home' ? items[0] : items.at(-1))?.focus();
    } else if (event.key === 'Tab') closeRecord(record, { restoreFocus: true });
  });

  const nativeValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() { return nativeValue.get.call(this); },
    set(value) { nativeValue.set.call(this, value); record.sync(); },
  });
  new MutationObserver(() => record.sync()).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label', 'value', 'aria-label'] });
  record.sync();
}

export function enhanceStyledDropdowns(root = document) {
  root.querySelectorAll('select:not([data-native-select="true"])').forEach(select => {
    if (select.dataset.styledDropdown === 'true') selectRecords.get(select)?.sync();
    else enhanceSelect(select);
  });
}

document.addEventListener('pointerdown', event => {
  if (!activeRecord) return;
  if (activeRecord.menu.contains(event.target) || activeRecord.wrapper.contains(event.target)) return;
  closeAllDropdowns();
});
window.addEventListener('resize', closeAllDropdowns);
window.addEventListener('scroll', closeAllDropdowns, true);
new MutationObserver(records => {
  for (const record of records) {
    const target = record.target;
    if (target instanceof HTMLElement && target.matches('.fx-modal, .changelog-modal')) {
      if (target.getAttribute('aria-hidden') === 'false' || target.classList.contains('is-open')) closeAllDropdowns();
    }
  }
}).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['aria-hidden', 'class'] });

new MutationObserver(records => {
  for (const record of records) {
    record.addedNodes.forEach(node => {
      if (!(node instanceof HTMLElement)) return;
      if (node.matches('select')) enhanceSelect(node);
      enhanceStyledDropdowns(node);
    });
  }
}).observe(document.body, { childList: true, subtree: true });
