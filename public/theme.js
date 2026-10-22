(() => {
  const key = 'connectx.theme';
  const modes = new Set(['system', 'light', 'dark']);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let mode = 'system';

  try {
    const saved = localStorage.getItem(key);
    if (modes.has(saved)) mode = saved;
  } catch { /* Keep the system default when storage is unavailable. */ }

  function apply() {
    const dark = mode === 'dark' || (mode === 'system' && media.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themeMode = mode;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = dark ? '#111b17' : '#f4f7f5';
  }

  window.connectXTheme = {
    getMode: () => mode,
    setMode(nextMode) {
      if (!modes.has(nextMode)) throw new Error('Choose system, light, or dark theme.');
      mode = nextMode;
      try {
        localStorage.setItem(key, mode);
      } catch (error) {
        console.warn('Could not save theme preference:', error.message);
      }
      apply();
    }
  };

  media.addEventListener?.('change', () => {
    if (mode === 'system') apply();
  });
  apply();
})();
