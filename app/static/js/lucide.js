// Local inline Lucide icons keep the interface crisp and available offline.
const icons = {
  'folder-open': '<path d="m6 14 1.5-2.5A2 2 0 0 1 9.2 10.5h11.3a1 1 0 0 1 .9 1.4l-3 6A2 2 0 0 1 16.6 19H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v3"/><path d="M2 16v-3a2 2 0 0 1 2-2h3"/>',
  copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  pencil: '<path d="M21.2 7.4 16.6 2.8a2 2 0 0 0-2.8 0L3 13.6V21h7.4L21.2 10.2a2 2 0 0 0 0-2.8Z"/><path d="m5 19 4-1 10-10-3-3L6 15l-1 4Z"/>',
  'trash-2': '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5m4-5v5"/>',
  x: '<path d="m18 6-12 12M6 6l12 12"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  play: '<path d="m7 4 13 8-13 8V4Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  square: '<rect x="4" y="4" width="16" height="16" rx="1"/>',
  mic: '<path d="M12 19v3"/><path d="M8 22h8"/><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2"/>',
  'audio-lines': '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
  drum: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/><path d="m7 2 3 3m7-3-3 3"/>',
  guitar: '<path d="M11.9 12.1 9.2 14.8"/><path d="m14.1 10.1 1.9-1.9 3.3-3.3a1.4 1.4 0 0 1 2 2L18 10.2l-1.9 1.9"/><path d="m6.5 15.5 2 2"/><path d="M10.4 8.7a3.1 3.1 0 0 0-4.4 0l-3.2 3.2a3.1 3.1 0 0 0 4.4 4.4l3.2-3.2a3.1 3.1 0 0 0 0-4.4Z"/><circle cx="7.2" cy="13.9" r=".7"/>',
  sparkles: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"/><path d="m19 14 1.1 3.1L23 18l-2.9 1-1.1 3-1-3-3-1 3-.9L19 14Z"/>',
  'volume-2': '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
  'volume-x': '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
  'rotate-ccw': '<path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 0 2.1-6.2L3 13"/>',
};

export function lucideIcon(name, { className = '', size = 24 } = {}) {
  const body = icons[name];
  if (!body) throw new Error(`Unknown Lucide icon: ${name}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="lucide${className ? ` ${className}` : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
