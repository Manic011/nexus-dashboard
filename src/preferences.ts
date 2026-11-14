import { useEffect, useState } from 'react';

const defaults = { theme: 'system', density: 'comfortable' } as const;
type Preferences = { theme: 'system' | 'dark' | 'light'; density: 'comfortable' | 'compact' };

function readPreferences(key: string): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}');
    return {
      theme: stored.theme === 'light' || stored.theme === 'dark' ? stored.theme : defaults.theme,
      density: stored.density === 'compact' ? 'compact' : defaults.density,
    };
  } catch {
    return defaults;
  }
}

export function usePreferences(username?: string | null) {
  const key = 'nexus:appearance:' + (username ?? '');
  const [saved, setSaved] = useState<{ key: string; value: Preferences }>();
  const value = saved?.key === key ? saved.value : readPreferences(key);

  useEffect(() => {
    document.documentElement.dataset.theme = value.theme;
    document.documentElement.dataset.density = value.density;
  }, [value.theme, value.density]);

  function update(changes: Partial<Preferences>) {
    const next = { ...value, ...changes };
    setSaved({ key, value: next });
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Keep preferences for this session. */ }
  }

  return { value, update };
}
