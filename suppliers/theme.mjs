const STORAGE_KEY = 'supplier-atlas-theme';
const preference = window.matchMedia?.('(prefers-color-scheme: dark)');
const validTheme = theme => theme === 'light' || theme === 'dark';

function savedTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return validTheme(value) ? value : null;
  } catch { return null; }
}

function systemTheme() { return preference?.matches ? 'dark' : 'light'; }

export function getTheme() {
  const theme = document.documentElement.dataset.theme;
  return validTheme(theme) ? theme : savedTheme() || systemTheme();
}

function updateButtons(theme) {
  const dark = theme === 'dark';
  for (const button of document.querySelectorAll('[data-theme-toggle]')) {
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', dark ? 'Switch to day mode' : 'Switch to night mode');
    button.title = dark ? 'Switch to day mode' : 'Switch to night mode';
    const label = button.querySelector('[data-theme-label]');
    if (label) label.textContent = dark ? 'Day mode' : 'Night mode';
  }
}

export function setTheme(theme, { persist = true } = {}) {
  if (!validTheme(theme)) throw new TypeError('Theme must be light or dark.');
  const changed = document.documentElement.dataset.theme !== theme;
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
  }
  updateButtons(theme);
  if (changed) window.dispatchEvent(new CustomEvent('supplier-theme-change', { detail: { theme } }));
}

function createIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'theme-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const moon = document.createElementNS(ns, 'path');
  moon.setAttribute('class', 'theme-moon');
  moon.setAttribute('d', 'M20.8 13.1A8.7 8.7 0 0 1 10.9 3.2 8.8 8.8 0 1 0 20.8 13.1Z');
  const sun = document.createElementNS(ns, 'g');
  sun.setAttribute('class', 'theme-sun');
  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '4');
  const rays = document.createElementNS(ns, 'path');
  rays.setAttribute('d', 'M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42');
  sun.append(circle, rays);
  svg.append(moon, sun);
  return svg;
}

for (const button of document.querySelectorAll('[data-theme-toggle]')) {
  button.prepend(createIcon());
  button.addEventListener('click', () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'));
}

setTheme(savedTheme() || systemTheme(), { persist: false });
preference?.addEventListener?.('change', () => {
  if (!savedTheme()) setTheme(systemTheme(), { persist: false });
});
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY || event.key === null) {
    setTheme(savedTheme() || systemTheme(), { persist: false });
  }
});
