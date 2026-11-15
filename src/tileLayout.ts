export type LayoutTile = { id: number; url: string; title: string };
export type Position = { row: number; column: number; width: number };
export type TileLayout = { columns: number; positions: Record<string, Position> };

export const columnOptions = [1, 2, 3, 4, 5, 6];
export const maxEmptyRows = 30;

export function tileKey(tile: LayoutTile) {
  return JSON.stringify([tile.id, tile.url]);
}

export function overlaps(a: Position, b: Position) {
  return a.row === b.row && a.column < b.column + b.width && b.column < a.column + a.width;
}

export function comparePositions(a: Position, b: Position) {
  return a.row - b.row || a.column - b.column;
}

export function gridPlacement(position: Position) {
  return { gridRow: position.row + 1, gridColumn: `${position.column + 1} / span ${position.width}` };
}

export function arrangeTiles(tiles: LayoutTile[], saved?: TileLayout | null, columns = saved?.columns ?? 4): TileLayout {
  const positions: TileLayout['positions'] = {};
  const occupied: Position[] = [];
  let nextSlot = 0;
  for (const tile of tiles) {
    const key = tileKey(tile);
    const position = saved?.positions[key];
    if (!position || !Number.isInteger(position.row) || position.row < 0 || position.row >= 10_000 ||
      !Number.isInteger(position.column) || position.column < 0 ||
      !Number.isInteger(position.width) || position.width < 1 || position.column + position.width > columns ||
      occupied.some(existing => overlaps(position, existing))) continue;
    positions[key] = position;
    occupied.push(position);
    nextSlot = Math.max(nextSlot, position.row * columns + position.column + position.width);
  }
  for (const tile of tiles) {
    const key = tileKey(tile);
    if (positions[key]) continue;
    positions[key] = { row: Math.floor(nextSlot / columns), column: nextSlot % columns, width: 1 };
    nextSlot++;
  }
  return { columns, positions };
}

function packRows(layout: TileLayout, columns: number, categories?: ReadonlyMap<string, string>, order: string[] = []): TileLayout {
  const entries = Object.entries(layout.positions).sort(([, a], [, b]) => comparePositions(a, b));
  const groups = categories ? Map.groupBy(entries, ([key]) => categories.get(key)) : new Map([[undefined, entries]]);
  let slot = 0;
  const positions: TileLayout['positions'] = {};
  for (const key of new Set([...order, ...groups.keys()])) {
    const group = groups.get(key);
    if (!group) continue;
    slot = Math.ceil(slot / columns) * columns;
    for (const [key, position] of group) {
      const width = Math.min(position.width, columns);
      if (slot % columns + width > columns) slot += columns - slot % columns;
      positions[key] = { row: Math.floor(slot / columns), column: slot % columns, width };
      slot += width;
    }
  }
  return { columns, positions };
}

export function changeColumns(layout: TileLayout, columns: number) {
  return packRows(layout, columns);
}

export function groupByCategory(layout: TileLayout, tiles: (LayoutTile & { category: string })[], order: string[]) {
  return packRows(layout, layout.columns, new Map(tiles.map(tile => [tileKey(tile), tile.category.toLowerCase()])), order);
}

export function moveTile(layout: TileLayout, key: string, target: Position, swap?: string): TileLayout | null {
  const from = layout.positions[key];
  if (!from || key === swap) return null;
  const moved = { ...target, width: from.width };
  const swapped = swap ? { ...from, width: layout.positions[swap].width } : null;
  const positions = { ...layout.positions, [key]: moved };
  if (swap && swapped) positions[swap] = swapped;
  const others = Object.entries(layout.positions).filter(([id]) => id !== key && id !== swap).map(([, position]) => position);
  if (moved.column + moved.width > layout.columns || others.some(position => overlaps(position, moved))) return null;
  if (swapped && (swapped.column + swapped.width > layout.columns || overlaps(swapped, moved) ||
    others.some(position => overlaps(position, swapped)))) return null;
  return { ...layout, positions };
}
