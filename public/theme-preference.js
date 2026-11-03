'use strict';
(function (root) {
  const key = 'dita-lite:theme';
  const themes = Object.freeze([
    Object.freeze({ id: 'forest', label: '青绿', description: '清爽克制，保持熟悉的工作台', scheme: 'light' }),
    Object.freeze({ id: 'blue', label: '经典蓝', description: '明亮清晰，突出结构与操作', scheme: 'light' }),
    Object.freeze({ id: 'paper', label: '暖纸', description: '柔和纸色，适合长时间阅读', scheme: 'light' }),
    Object.freeze({ id: 'dark', label: '深色', description: '降低亮度，适合夜间编写', scheme: 'dark' }),
    Object.freeze({ id: 'system', label: '跟随系统', description: '随系统自动切换青绿与深色', scheme: 'auto' })
  ]);
  // Browser preference only: no document state, repository or delivery access.
  function createPreference({ read, write, system, apply }) {
    const valid = value => themes.some(theme => theme.id === value);
    let value = 'forest', stored = true;
    try { const saved = read(key); if (valid(saved)) value = saved; } catch { stored = false; }
    const listeners = new Set();
    const resolved = () => value === 'system' ? system.matches ? 'dark' : 'forest' : value;
    function render() { apply(resolved()); for (const listener of listeners) listener(); }
    const changed = () => { if (value === 'system') render(); };
    system.addEventListener('change', changed);
    render();
    return Object.freeze({ themes,
      get value() { return value; }, get resolved() { return resolved(); }, get stored() { return stored; },
      set(next) {
        if (!valid(next)) throw new TypeError('未知的界面风格');
        value = next;
        try { write(key, value); stored = true; } catch { stored = false; }
        render();
      },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
    });
  }
  const api = { createPreference, themes, key };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaThemePreference = api;
})(typeof window === 'undefined' ? globalThis : window);
