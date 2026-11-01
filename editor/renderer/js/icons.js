// ETBR Mapper icon set — drawn for this app on a 24px grid, 1.8px rounded strokes (no emoji anywhere).
// icon('name') -> <svg>; hydrateIcons(root) swaps <i data-icon="name"> placeholders.
const P = {
  // files
  new: '<path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5z"/><path d="M14 3.5V8h4"/><path d="M12 11v6M9 14h6"/>',
  open: '<path d="M3.5 7V18a1 1 0 0 0 1 1h14.2a1 1 0 0 0 1-.8l1.6-7a.8.8 0 0 0-.8-1H7.6a1 1 0 0 0-1 .8L4.6 18"/><path d="M3.5 7a1 1 0 0 1 1-1h4l2 2h6.5a1 1 0 0 1 1 1v1.2"/>',
  save: '<path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4z"/><path d="M8 4v4.5h7V4"/><rect x="8" y="13" width="8" height="7" rx=".5"/>',
  export: '<path d="M12 3.5v11"/><path d="M8 7.5l4-4 4 4"/><path d="M5 13v5.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V13"/>',
  file: '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5V8h4"/><path d="M9.5 12.5h6M9.5 15.5h6"/>',
  recover: '<path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4"/><path d="M4 4.5v4h4"/><path d="M12 8.5V12l2.5 2"/>',
  // edit
  undo: '<path d="M9 7.5L5 11.5l4 4"/><path d="M5.5 11.5H15a4.5 4.5 0 0 1 0 9h-3"/>',
  redo: '<path d="M15 7.5l4 4-4 4"/><path d="M18.5 11.5H9a4.5 4.5 0 0 0 0 9h3"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M9.5 5.5L12 3l2.5 2.5M9.5 18.5L12 21l2.5-2.5M5.5 9.5L3 12l2.5 2.5M18.5 9.5L21 12l-2.5 2.5"/>',
  rotate: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 3.8v3.7h-3.7"/><circle cx="12" cy="12" r="1.4"/>',
  scale: '<rect x="3.5" y="11.5" width="9" height="9" rx="1"/><path d="M12 3.5h8.5V12"/><path d="M20 4L13.5 10.5"/><path d="M15 3.5v0"/>',
  room: '<path d="M4 8.5L12 4l8 4.5v7L12 20l-8-4.5z"/><path d="M4 8.5L12 13l8-4.5M12 13v7"/>',
  duplicate: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h3.5"/>',
  focus: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><circle cx="12" cy="12" r="3"/>',
  floor: '<path d="M12 4v10"/><path d="M8.5 10.5L12 14l3.5-3.5"/><path d="M4 19.5h16"/><path d="M6 17l2 2.5M10 17l2 2.5M14 17l2 2.5"/>',
  trash: '<path d="M4.5 6.5h15"/><path d="M9 6.5V4.5h6v2"/><path d="M6.5 6.5l1 13a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9l1-13"/><path d="M10 10.5v6M14 10.5v6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4"/><path d="M4 4.5v4h4"/>',
  layer: '<path d="M12 4l8.5 4.5L12 13 3.5 8.5z"/><path d="M3.5 12.5L12 17l8.5-4.5"/><path d="M3.5 16.5L12 21l8.5-4.5"/>',
  // view
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M4 4l16 16"/><path d="M9.9 6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.6 7.7C4 9.6 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-1"/><path d="M10 10.2a3 3 0 0 0 4 4"/>',
  cursor: '<path d="M5 3.5l13 7-5.5 1.6L10 18z"/><path d="M12.5 12.1l5 5"/>',
  crosshair: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.2-2.5 3.8"/><path d="M12 17.2v.3"/>',
  // collab
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><path d="M15.5 4.9a3.2 3.2 0 0 1 0 6.2M17.5 14.7c1.8.6 3 2.3 3.5 4.8"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  chat: '<path d="M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4.5 3.5v-3.5h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2"/>',
  live: '<circle cx="12" cy="12" r="3.5" fill="currentColor"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4"/>',
  play: '<path d="M7.5 4.8v14.4a.6.6 0 0 0 .9.5l11.2-7.2a.6.6 0 0 0 0-1L8.4 4.3a.6.6 0 0 0-.9.5z"/>',
  gamepad: '<path d="M7 7.5h10a4.5 4.5 0 0 1 4.4 5.5l-.8 3.6a2.3 2.3 0 0 1-4 .9L14.8 15.5H9.2l-1.8 2a2.3 2.3 0 0 1-4-.9L2.6 13A4.5 4.5 0 0 1 7 7.5z"/><path d="M7.5 10v4M5.5 12h4"/><path d="M15.5 11h.01M17.5 13h.01"/>',
  // library categories
  kits: '<path d="M3.5 6.5h17v11h-17z"/><path d="M3.5 12h17M9 6.5V12M15 12v5.5M12 6.5v-.01"/>',
  entity: '<path d="M12 3.5c-4 0-6.5 3.2-6.5 7.5 0 3 1 5.5 1 9.5l2-1.5 1.7 1.5L12 19l1.8 1.5 1.7-1.5 2 1.5c0-4 1-6.5 1-9.5 0-4.3-2.5-7.5-6.5-7.5z"/><path d="M9.3 10.5l1.5.8M14.7 10.5l-1.5.8"/>',
  item: '<path d="M9 3.5h6v4l-1.5 2v9.5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1V9.5L9 7.5z"/><path d="M9 7.5h6"/><path d="M12 12.5v2"/>',
  light: '<path d="M8.5 15c-1.6-1.2-2.8-3-2.8-5.2a6.3 6.3 0 1 1 12.6 0c0 2.2-1.2 4-2.8 5.2"/><path d="M9 18h6M10 21h4"/><path d="M10 15h4"/>',
  gameplay: '<path d="M6 20.5V4.5"/><path d="M6 5h11l-2.5 3.5L17 12H6"/>',
  meshes: '<path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z"/><path d="M4.5 7.7L12 12l7.5-4.3M12 12v8.5"/>',
  logic: '<path d="M4 7h4l3 5-3 5H4M20 7h-4l-3 5 3 5h4"/>',
  custom: '<path d="M12 3.5l2.4 5 5.4.6-4 3.7 1.1 5.4L12 15.6l-4.9 2.6 1.1-5.4-4-3.7 5.4-.6z"/>',
  // logic + misc
  spawn: '<circle cx="12" cy="6" r="2.5"/><path d="M12 8.5v6.5M8.5 11.5h7M9.5 20l2.5-5 2.5 5"/>',
  zone: '<rect x="4" y="4" width="16" height="16" rx="1.5" stroke-dasharray="3 2.2"/><circle cx="12" cy="12" r="2.2"/>',
  stack: '<rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/><rect x="8.5" y="4" width="7" height="7" rx="1"/>',
  mouse: '<rect x="6.5" y="3.5" width="11" height="17" rx="5.5"/><path d="M12 3.5v6M6.5 9.5h11"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  warn: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5M12 17v.01"/>',
  arrowRight: '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M7.5 5v14M16.5 5v14M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4"/>',
  import: '<path d="M12 3.5v11"/><path d="M8 10.5l4 4 4-4"/><path d="M5 15v3.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V15"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  wave: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11M11 10V5a1.5 1.5 0 0 1 3 0v6M14 10.5V6.5a1.5 1.5 0 0 1 3 0V14a6.5 6.5 0 0 1-12.2 3.1L3.4 13.5a1.5 1.5 0 0 1 2.4-1.8L8 14"/>',
};

export function icon(name, size = 16, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('class', 'ic ' + cls); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || P.help;
  return s;
}
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('i[data-icon]')) el.replaceWith(icon(el.dataset.icon, +(el.dataset.size || 16), el.className));
}
// The logo: a lit doorway at the end of a yellow corridor
export function logoMark(size = 22) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 32 32'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('class', 'logo-svg');
  s.innerHTML = '<path d="M2 3h28v26H2z" fill="#2a2614"/><path d="M2 3l9 7h10l9-7z" fill="#cdb453"/><path d="M2 29l9-7h10l9 7z" fill="#8f7c33"/>'
    + '<path d="M2 3l9 7v12l-9 7z" fill="#e3c862"/><path d="M30 3l-9 7v12l9 7z" fill="#bfa64a"/><rect x="13.2" y="12.5" width="5.6" height="9.5" fill="#fff6c8"/>'
    + '<path d="M11 10h10v12H11z" fill="none" stroke="#5a4f22" stroke-width=".8"/>';
  return s;
}
