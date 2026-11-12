// Run before CSS so the saved appearance is applied before the first paint.
(() => {
  let saved = null;
  try { saved = localStorage.getItem('supplier-atlas-theme'); } catch {}
  const preferred = saved === 'light' || saved === 'dark'
    ? saved
    : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = preferred;
})();
