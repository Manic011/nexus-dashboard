import { Folder, Plus } from 'lucide-react';
import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { CategoryDivider, TileGrid } from './CategoryDivider.js';
import { categoryName, categoryRows, orderedCategories, type LayoutCategories } from './layoutCategories.js';
import { arrangeTiles, changeColumns, columnOptions, comparePositions, gridPlacement, groupByCategory, maxEmptyRows, moveTile, overlaps, tileKey, type LayoutTile, type Position, type TileLayout } from './tileLayout.js';

type EditorTile = LayoutTile & { category: string; tags: string[] };

export function LayoutEditor<T extends EditorTile>({ tiles, categories, tags, initialCategory, initialTag, saved, categorySettings, renderTile, groupedPreview, onSave, onCancel }: {
  tiles: T[];
  categories: ReadonlyMap<string, string>;
  tags: ReadonlyMap<string, string>;
  initialCategory: string;
  initialTag: string;
  saved: TileLayout | null;
  categorySettings: LayoutCategories;
  renderTile: (tile: T, position: Position, settings: LayoutCategories, overlay?: ReactNode) => ReactNode;
  groupedPreview: (settings: LayoutCategories) => ReactNode;
  onSave: (layout: TileLayout | null, settings: LayoutCategories) => void;
  onCancel: () => void;
}) {
  const [layout, setLayout] = useState(() => arrangeTiles(tiles, saved));
  const [grouped, setGrouped] = useState(false);
  const [preview, setPreview] = useState(false);
  const [settings, setSettings] = useState(categorySettings);
  const [selected, setSelected] = useState('');
  const [category, setCategory] = useState(initialCategory);
  const [tag, setTag] = useState(initialTag);
  const [message, setMessage] = useState('');
  const [extraRows, setExtraRows] = useState(0);
  const dragged = useRef('');
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focusTile = useRef('');
  const tilesByKey = new Map(tiles.map(tile => [tileKey(tile), tile]));
  const title = (key: string) => tilesByKey.get(key)?.title ?? '';
  const highlighted = Boolean(category || tag);
  const matches = new Set(tiles.filter(tile => (!category || tile.category.toLowerCase() === category) &&
    (!tag || tile.tags.some(value => value.toLowerCase() === tag))).map(tileKey));
  const position = layout.positions[selected];
  const lastRow = Math.max(0, ...Object.values(layout.positions).map(slot => slot.row));
  const rowCount = lastRow + 2 + extraRows;
  const cells = new Map<number, { key: string; position: Position }>();
  for (const [key, slot] of Object.entries(layout.positions)) {
    for (let column = slot.column; column < slot.column + slot.width; column++) {
      cells.set(slot.row * layout.columns + column, { key, position: slot });
    }
  }
  const orderedTiles = [...tiles].sort((a, b) => comparePositions(layout.positions[tileKey(a)], layout.positions[tileKey(b)]));
  const categoryOrder = orderedCategories(categories, settings.order);
  const { headings, gridRow } = categoryRows(orderedTiles, layout, settings);

  function divider(slot: Position) {
    const keys = headings.get(slot.row);
    return slot.column === 0 && keys && <CategoryDivider categoryKeys={keys} categories={categories} settings={settings} row={gridRow(slot.row)} />;
  }

  function moveCategory(index: number, offset: number) {
    const order = [...categoryOrder];
    const next = index + offset;
    [order[index], order[next]] = [order[next], order[index]];
    setSettings({ ...settings, order });
  }

  useLayoutEffect(() => {
    if (!focusTile.current) return;
    buttons.current.get(focusTile.current)?.focus();
    focusTile.current = '';
  }, [layout]);

  function place(key: string, destination: Position, swap?: string) {
    const next = moveTile(layout, key, destination, swap);
    if (!next) {
      setMessage('There is not enough room at that position. Try an open cell or a narrower tile.');
      return;
    }
    setLayout(next);
    setSelected(key);
    setMessage(`${title(key)} moved to row ${destination.row + 1}, column ${destination.column + 1}.`);
    focusTile.current = key;
    setExtraRows(0);
  }

  function drop(event: DragEvent, destination: Position, swap?: string) {
    if (!dragged.current) return;
    event.preventDefault();
    if (dragged.current !== swap) place(dragged.current, destination, swap);
    dragged.current = '';
  }

  function resize(width: number) {
    if (!position) return;
    const next = { ...position, width };
    if (next.column + width > layout.columns ||
      Object.entries(layout.positions).some(([key, slot]) => key !== selected && overlaps(slot, next))) {
      setMessage('This tile needs more free space to its right.');
      return;
    }
    setLayout({ ...layout, positions: { ...layout.positions, [selected]: next } });
    setMessage(`${title(selected)} now spans ${width} ${width === 1 ? 'column' : 'columns'}.`);
  }

  return <section className="layout-editor" aria-labelledby="layout-heading">
    <div className="layout-settings">
      <h2 id="layout-heading">Customize layout</h2>
      <div className="layout-toolbar">
        <label>Layout<select aria-label="Layout" autoFocus value={grouped ? 'categories' : 'custom'} onChange={event => {
          setGrouped(event.target.value === 'categories');
          setMessage('');
        }}>
          <option value="custom">Custom grid</option><option value="categories">Grouped by category</option>
        </select></label>
        {!grouped && !preview && <>
          <label>Columns<select aria-label="Columns" value={layout.columns} onChange={event => {
            setLayout(changeColumns(layout, Number(event.target.value)));
            setExtraRows(0);
            setMessage('Tiles were packed in their current order to fit the new column count.');
          }}>{columnOptions.map(count => <option key={count}>{count}</option>)}</select></label>
          {position && <label>Width for {title(selected)}<select aria-label={`Width for ${title(selected)}`} value={position.width} onChange={event => resize(Number(event.target.value))}>
            {columnOptions.filter(count => count <= layout.columns).map(count => <option key={count} value={count}>{count} {count === 1 ? 'column' : 'columns'}</option>)}
          </select></label>}
        </>}
        {!grouped && <button type="button" onClick={() => setPreview(value => !value)}>
          {preview ? 'Back to editing' : 'Preview layout'}
        </button>}
      </div>
      <details className="layout-categories">
        <summary>Category settings</summary>
        <label className="category-toggle"><input type="checkbox" checked={settings.dividers} onChange={event => setSettings({ ...settings, dividers: event.target.checked })} /> Show category dividers in custom grid</label>
        <p className="muted">Display names are personal. Order applies to category sections and when you choose Arrange by category.</p>
        <ul>
          {categoryOrder.map((key, index) => {
            const name = categories.get(key)!;
            return <li key={key}>
              <label>{name}<input aria-label={`Display name for ${name}`} placeholder={name} maxLength={60} value={Object.hasOwn(settings.names, key) ? settings.names[key] : ''}
                onChange={event => setSettings({ ...settings, names: { ...settings.names, [key]: event.target.value } })} /></label>
              <button type="button" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => moveCategory(index, -1)}>↑</button>
              <button type="button" aria-label={`Move ${name} down`} disabled={index === categoryOrder.length - 1} onClick={() => moveCategory(index, 1)}>↓</button>
            </li>;
          })}
        </ul>
      </details>
      {grouped ? <p className="muted">Category sections preview</p> : preview ? <p className="muted">Layout preview at your current screen size</p> : <>
        <p className="muted">Drag tiles or select one, then choose an empty cell to move it or another tile to swap. Select it again to deselect.</p>
        <div className="layout-toolbar layout-organize">
          <label>Highlight category<select aria-label="Highlight category" value={category} onChange={event => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {categoryOrder.map(key => <option key={key} value={key}>{categoryName(key, categories.get(key)!, settings)}</option>)}
          </select></label>
          <label>Highlight tag<select aria-label="Highlight tag" value={tag} onChange={event => setTag(event.target.value)}>
            <option value="">All tags</option>
            {[...tags].map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          {highlighted && <button type="button" onClick={() => { setCategory(''); setTag(''); }}>Clear highlights</button>}
          <button type="button" onClick={() => {
            setLayout(groupByCategory(layout, tiles, settings.order));
            setExtraRows(0);
            setMessage('Each category now starts on its own row.');
          }}><Folder size={16} aria-hidden="true" /> Arrange by category</button>
        </div>
        {highlighted && <p className="muted" role="status">{matches.size} of {tiles.length} tiles match. All tiles stay in place.</p>}
      </>}
    </div>
    {grouped ? groupedPreview(settings) : preview ? <TileGrid tiles={orderedTiles} layout={layout} categories={categories} settings={settings}
      renderTile={(tile, position) => renderTile(tile, position, settings)} /> : <>
      <div className="custom-layout layout-scroll">
        <div className="grid custom-grid layout-board" data-columns={layout.columns} style={{ '--columns': layout.columns } as CSSProperties}>
          {Array.from({ length: rowCount * layout.columns }, (_, index) => {
            const slot = { row: Math.floor(index / layout.columns), column: index % layout.columns, width: 1 };
            const cell = cells.get(index);
            if (cell && cell.position.column !== slot.column) return null;
            const allowDrop = (event: DragEvent) => { if (dragged.current) event.preventDefault(); };
            if (cell) {
              const { key, position } = cell;
              const tile = tilesByKey.get(key)!;
              const card = renderTile(tile, { ...position, row: gridRow(position.row) }, settings, <button type="button" className="layout-piece"
                data-match={highlighted ? matches.has(key) : undefined}
                aria-label={`${tile.title}, row ${position.row + 1}, column ${position.column + 1}`}
                aria-description={[tile.category, ...tile.tags, highlighted && (matches.has(key) ? 'Matches highlights' : 'Outside highlights')].filter(Boolean).join('. ')}
                aria-pressed={selected === key} draggable
                ref={element => { if (element) buttons.current.set(key, element); else buttons.current.delete(key); }}
                onClick={() => {
                  setMessage('');
                  if (selected && selected !== key) place(selected, position, key);
                  else setSelected(selected === key ? '' : key);
                }}
                onDragStart={event => {
                  dragged.current = key;
                  setSelected(key);
                  event.dataTransfer.setData('text/plain', tile.title);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => { dragged.current = ''; }}
                onDragOver={allowDrop} onDrop={event => drop(event, position, key)} />);
              return <Fragment key={key}>{divider(slot)}{card}</Fragment>;
            }
            return <Fragment key={`slot-${index}`}>{divider(slot)}<button type="button" className="layout-slot" style={gridPlacement({ ...slot, row: gridRow(slot.row) })}
              aria-label={`Empty cell, row ${slot.row + 1}, column ${slot.column + 1}`}
              tabIndex={selected ? 0 : -1} aria-disabled={!selected}
              onClick={() => { if (selected) place(selected, slot); }}
              onDragOver={allowDrop} onDrop={event => drop(event, slot)}>
              <Plus size={16} aria-hidden="true" />
            </button></Fragment>;
          })}
        </div>
      </div>
      <button type="button" disabled={extraRows >= maxEmptyRows} onClick={() => setExtraRows(extraRows + 1)}><Plus size={16} /> Add row</button>
    </>}
    {message && !preview && !grouped && <p className="layout-feedback muted" role="status">{message}</p>}
    <div className="form-actions layout-actions">
      <button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" className="primary" onClick={() => onSave(grouped ? null : layout, settings)}>Save layout</button>
    </div>
  </section>;
}
