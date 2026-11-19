'use strict';
// Run before styles/first paint so a saved dark preference never flashes white.
window.DitaTheme = window.DitaThemePreference.createPreference({
  read: key => window.localStorage.getItem(key),
  write: (key, value) => window.localStorage.setItem(key, value),
  system: window.matchMedia('(prefers-color-scheme: dark)'),
  apply: theme => { document.documentElement.dataset.theme = theme; }
});
