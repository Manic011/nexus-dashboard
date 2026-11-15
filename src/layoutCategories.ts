import { tileKey, type LayoutTile, type TileLayout } from './tileLayout.js';

export type LayoutCategories = { dividers: boolean; order: string[]; names: Record<string, string> };
export const defaultLayoutCategories: LayoutCategories = { dividers: false, order: [], names: {} };

export function categoryName(key: string, fallback: string, settings: LayoutCategories) {
  return Object.hasOwn(settings.names, key) ? settings.names[key].trim() || fallback : fallback;
}

export function orderedCategories(categories: ReadonlyMap<string, unknown>, order: string[]) {
  return [...new Set([...order.filter(key => categories.has(key)), ...categories.keys()])];
}

export function categoryRows(tiles: (LayoutTile & { category: string })[], layout: TileLayout, settings: LayoutCategories) {
  const headings = new Map<number, string[]>();
  if (settings.dividers) {
    const rows = Map.groupBy(tiles, tile => layout.positions[tileKey(tile)].row);
    let previous = '';
    for (const [row, items] of [...rows].sort(([a], [b]) => a - b)) {
      const keys = [...new Set(items.map(tile => tile.category.toLowerCase()))];
      const signature = JSON.stringify([...keys].sort());
      if (signature !== previous) headings.set(row, keys);
      previous = signature;
    }
  }
  const starts = [...headings.keys()];
  return { headings, gridRow: (row: number) => row + starts.filter(start => start <= row).length };
}
