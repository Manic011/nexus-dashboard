import { Fragment, type HTMLAttributes, type ReactNode } from 'react';
import { categoryName, categoryRows, type LayoutCategories } from './layoutCategories.js';
import { tileKey, type LayoutTile, type Position, type TileLayout } from './tileLayout.js';

export function CategoryDivider({ categoryKeys, categories, settings, row, dropProps }: {
  categoryKeys: string[];
  categories: ReadonlyMap<string, string>;
  settings: LayoutCategories;
  row?: number;
  dropProps?: HTMLAttributes<HTMLHeadingElement>;
}) {
  return <h2 className="category-divider" {...dropProps} style={row === undefined ? undefined : { '--category-row': row } as React.CSSProperties}>
    {categoryKeys.map(key => categoryName(key, categories.get(key) ?? key, settings)).join(' · ')}
  </h2>;
}

export function TileGrid<T extends LayoutTile & { category: string }>({ tiles, layout, categories, settings, renderTile }: {
  tiles: T[];
  layout: TileLayout;
  categories: ReadonlyMap<string, string>;
  settings: LayoutCategories;
  renderTile: (tile: T, position: Position) => ReactNode;
}) {
  const { headings, gridRow } = categoryRows(tiles, layout, settings);
  const rows = Map.groupBy(tiles, tile => layout.positions[tileKey(tile)].row);
  return <div className="custom-layout">
    <div className="grid custom-grid" data-columns={layout.columns}>
      {[...rows].map(([row, items]) => <Fragment key={row}>
        {headings.has(row) && <CategoryDivider categoryKeys={headings.get(row)!} categories={categories} settings={settings} row={gridRow(row)} />}
        {items.map(tile => renderTile(tile, { ...layout.positions[tileKey(tile)], row: gridRow(row) }))}
      </Fragment>)}
    </div>
  </div>;
}
