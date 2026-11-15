import { useEffect, useState } from 'react';
import { columnOptions, type TileLayout } from './tileLayout.js';

export const openModes = [
  { value: 'new-tab', label: 'New browser tab' },
  { value: 'embedded', label: 'Embedded browser' },
  { value: 'kasm', label: 'Kasm remote browser' },
] as const;
export type OpenMode = (typeof openModes)[number]['value'];

const defaults = { theme: 'system', density: 'comfortable', openMode: 'embedded', tileLayout: null } as const;
type Preferences = { theme: 'system' | 'dark' | 'light'; density: 'comfortable' | 'compact'; openMode: OpenMode; tileLayout: TileLayout | null };

function readPreferences(key: string): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}');
    return {
      theme: stored.theme === 'light' || stored.theme === 'dark' ? stored.theme : defaults.theme,
      density: stored.density === 'compact' ? 'compact' : defaults.density,
      openMode: openModes.find(mode => mode.value === stored.openMode)?.value ?? defaults.openMode,
      tileLayout: columnOptions.includes(stored.tileLayout?.columns) && stored.tileLayout?.positions &&
        typeof stored.tileLayout.positions === 'object' && !Array.isArray(stored.tileLayout.positions) ? stored.tileLayout : null,
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
    try {
      localStorage.setItem(key, JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  }

  return { value, update };
}
