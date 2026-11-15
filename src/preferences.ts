import { useEffect, useState } from 'react';
import { columnOptions, type TileLayout } from './tileLayout.js';
import { defaultLayoutCategories, type LayoutCategories } from './layoutCategories.js';

export const openModes = [
  { value: 'new-tab', label: 'New browser tab' },
  { value: 'embedded', label: 'Embedded browser' },
  { value: 'kasm', label: 'Kasm remote browser' },
] as const;
export type OpenMode = (typeof openModes)[number]['value'];

const defaults = { theme: 'system', density: 'comfortable', openMode: 'embedded', tileLayout: null, layoutCategories: defaultLayoutCategories } as const;
type Preferences = { theme: 'system' | 'dark' | 'light'; density: 'comfortable' | 'compact'; openMode: OpenMode; tileLayout: TileLayout | null; layoutCategories: LayoutCategories };

function readPreferences(key: string): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}');
    const categorySettings = stored.layoutCategories;
    return {
      theme: stored.theme === 'light' || stored.theme === 'dark' ? stored.theme : defaults.theme,
      density: stored.density === 'compact' ? 'compact' : defaults.density,
      openMode: openModes.find(mode => mode.value === stored.openMode)?.value ?? defaults.openMode,
      tileLayout: columnOptions.includes(stored.tileLayout?.columns) && stored.tileLayout?.positions &&
        typeof stored.tileLayout.positions === 'object' && !Array.isArray(stored.tileLayout.positions) ? stored.tileLayout : null,
      layoutCategories: {
        dividers: categorySettings?.dividers === true,
        order: Array.isArray(categorySettings?.order) ? categorySettings.order.filter((key: unknown) => typeof key === 'string') : [],
        names: Object.fromEntries(Object.entries(categorySettings?.names ?? {})
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
      },
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
