import { Folder, GripVertical, Plus } from 'lucide-react';
import { Fragment, useLayoutEffect, useRef, useState, type DragEvent, type HTMLAttributes, type ReactNode } from 'react';
import { CategoryDivider, TileGrid } from './CategoryDivider.js';
import { categoryName, categoryRows, orderedCategories, orderGroupedTiles, type LayoutCategories } from './layoutCategories.js';
import { arrangeTiles, changeColumns, columnOptions, comparePositions, gridPlacement, groupByCategory, maxEmptyRows, moveTile, overlaps, tileKey, type LayoutTile, type Position, type TileLayout } from './tileLayout.js';

type EditorTile = LayoutTile & { category: string; tags: string[] };
export type CategoryMove = { id: number; url: string; from: string; category: string };
export type CategoryDropProps = Pick<HTMLAttributes<HTMLElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'> & {
  'data-drop-target'?: boolean;
  'data-category-insert'?: 'before' | 'after';
};

export function LayoutEditor<T extends EditorTile>({ tiles: originalTiles, categories, tags, initialCategory, initialTag, saved, categorySettings, canEditTiles, saving, renderTile, renderGroups, onSave, onCancel }: {
  tiles: T[];
  categories: ReadonlyMap<string, string>;
  tags: ReadonlyMap<string, string>;
  initialCategory: string;
  initialTag: string;
  saved: TileLayout | null;
  categorySettings: LayoutCategories;
  canEditTiles: boolean;
  saving: boolean;
  renderTile: (tile: T, position: Position, settings: LayoutCategories, overlay?: ReactNode) => ReactNode;
  renderGroups: (tiles: T[], settings: LayoutCategories, overlay?: (tile: T) => ReactNode,
    dropProps?: (category: string) => CategoryDropProps, categoryControl?: (category: string) => ReactNode) => ReactNode;
  onSave: (layout: TileLayout | null, settings: LayoutCategories, moves: CategoryMove[]) => void;
  onCancel: () => void;
}) {
  const [layout, setLayout] = useState(() => arrangeTiles(originalTiles, saved));
  const [grouped, setGrouped] = useState(!saved);
  const [preview, setPreview] = useState(false);
  const [settings, setSettings] = useState(categorySettings);
  const [assignments, setAssignments] = useState(new Map<number, string>());
  const [selected, setSelected] = useState('');
  const [category, setCategory] = useState(initialCategory);
  const [tag, setTag] = useState(initialTag);
  const [message, setMessage] = useState('');
  const [extraRows, setExtraRows] = useState(0);
  const [dropTarget, setDropTarget] = useState('');
  const [categoryDrop, setCategoryDrop] = useState<{ key: string; side: 'before' | 'after' }>();
  const dragged = useRef('');
  const draggedCategory = useRef('');
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const focusTile = useRef('');
  const focusCategory = useRef('');
  const moves = originalTiles.flatMap(tile => {
    const category = assignments.get(tile.id);
    return category && category !== tile.category ? [{ id: tile.id, url: tile.url, from: tile.category, category }] : [];
  });
  const tiles = originalTiles.map(tile => ({ ...tile, category: assignments.get(tile.id) ?? tile.category }));
  const tilesByKey = new Map(tiles.map(tile => [tileKey(tile), tile]));
  const selectedTile = tilesByKey.get(selected);
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
  const populated = new Set(tiles.map(tile => tile.category.toLowerCase()));
  const sectionOrder = categoryOrder.filter(key => populated.has(key));
  const { headings, gridRow } = categoryRows(orderedTiles, layout, settings);

  function divider(slot: Position) {
    const keys = headings.get(slot.row);
    return slot.column === 0 && keys && <CategoryDivider categoryKeys={keys} categories={categories} settings={settings} row={gridRow(slot.row)}
      dropProps={keys.length === 1 ? categoryDropProps(keys[0], (source, category) => moveToDivider(source, category, slot.row), `row-${slot.row}`) : undefined} />;
  }

  function moveToDivider(source: string, category: string, row: number) {
    const width = layout.positions[source].width;
    for (let column = 0; column + width <= layout.columns; column++) {
      const next = moveTile(layout, source, { row, column, width });
      if (!next) continue;
      setLayout(next);
      moveToCategory(source, category);
      return;
    }
    const positions = Object.fromEntries(Object.entries(layout.positions).map(([key, position]) =>
      [key, position.row > row ? { ...position, row: position.row + 1 } : position]));
    positions[source] = { row: row + 1, column: 0, width };
    setLayout({ ...layout, positions });
    moveToCategory(source, category);
  }

  function moveCategory(index: number, offset: number) {
    const order = [...categoryOrder];
    const next = index + offset;
    [order[index], order[next]] = [order[next], order[index]];
    setSettings({ ...settings, order });
  }

  function moveSection(source: string, target: string, side: 'before' | 'after') {
    if (source === target) return;
    const order = categoryOrder.filter(key => key !== source);
    order.splice(order.indexOf(target) + (side === 'after' ? 1 : 0), 0, source);
    focusCategory.current = source;
    setSettings({ ...settings, order });
    const name = categoryName(source, categories.get(source) ?? source, settings);
    setMessage(`${name} moved to category position ${order.filter(key => populated.has(key)).indexOf(source) + 1}.`);
  }

  useLayoutEffect(() => {
    if (focusCategory.current) {
      handles.current.get(focusCategory.current)?.focus({ preventScroll: true });
      focusCategory.current = '';
    }
    if (focusTile.current) {
      buttons.current.get(focusTile.current)?.focus();
      focusTile.current = '';
    }
  }, [layout, settings]);

  function moveToCategory(key: string, category: string, before?: string) {
    const tile = tilesByKey.get(key);
    if (!tile) return;
    const changesCategory = tile.category.toLowerCase() !== category.toLowerCase();
    if (changesCategory && !canEditTiles) return;
    const order = orderGroupedTiles(tiles, settings.tileOrder).map(tileKey).filter(item => item !== key);
    order.splice(before ? order.indexOf(before) : order.length, 0, key);
    if (changesCategory) setAssignments(new Map(assignments).set(tile.id, category));
    setSettings({ ...settings, tileOrder: order });
    setSelected(key);
    focusTile.current = key;
    setMessage(`${tile.title} moved to ${categoryName(category.toLowerCase(), category, settings)}.`);
  }

  function endDrag() {
    dragged.current = '';
    draggedCategory.current = '';
    setDropTarget('');
    setCategoryDrop(undefined);
  }

  function sectionHandle(key: string) {
    if (sectionOrder.length < 2) return null;
    const name = categoryName(key, categories.get(key) ?? key, settings);
    return <button type="button" className="category-grip" draggable
      aria-label={`Reorder ${name} category`} aria-description="Drag the category or use the Up and Down arrow keys."
      title="Drag category or use arrow keys"
      ref={element => { if (element) handles.current.set(key, element); else handles.current.delete(key); }}
      onKeyDown={event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const up = event.key === 'ArrowUp';
        const target = sectionOrder[sectionOrder.indexOf(key) + (up ? -1 : 1)];
        if (target) moveSection(key, target, up ? 'before' : 'after');
      }}
      onDragStart={event => {
        draggedCategory.current = key;
        event.dataTransfer.setData('text/plain', name);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={endDrag}><GripVertical size={17} aria-hidden="true" /></button>;
  }

  function sectionDropProps(key: string): CategoryDropProps {
    const tileDrop = categoryDropProps(key);
    const insertSide = (event: DragEvent) => {
      const box = event.currentTarget.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2 ? 'before' : 'after';
    };
    return {
      ...tileDrop,
      'data-category-insert': categoryDrop?.key === key ? categoryDrop.side : undefined,
      onDragOver(event) {
        if (!draggedCategory.current) return tileDrop.onDragOver?.(event);
        if (draggedCategory.current === key) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const side = insertSide(event);
        setCategoryDrop(current => current?.key === key && current.side === side ? current : { key, side });
      },
      onDragLeave(event) {
        if (!draggedCategory.current) return tileDrop.onDragLeave?.(event);
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setCategoryDrop(current => current?.key === key ? undefined : current);
      },
      onDrop(event) {
        if (!draggedCategory.current) return tileDrop.onDrop?.(event);
        if (draggedCategory.current === key) return;
        event.preventDefault();
        moveSection(draggedCategory.current, key, insertSide(event));
        endDrag();
      },
    };
  }

  function categoryDropProps(key: string, move = moveToCategory, target = key): CategoryDropProps {
    const acceptsDrop = () => {
      const tile = tilesByKey.get(dragged.current);
      return tile && (canEditTiles || tile.category.toLowerCase() === key);
    };
    return {
      'data-drop-target': dropTarget === target,
      onDragOver(event) {
        if (!acceptsDrop()) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropTarget(target);
      },
      onDragLeave(event) {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setDropTarget(current => current === target ? '' : current);
      },
      onDrop(event) {
        const category = categories.get(key);
        if (!category || !acceptsDrop()) return;
        event.preventDefault();
        move(dragged.current, category);
        endDrag();
      },
    };
  }

  function swapGrouped(key: string, target: string) {
    if (key === target) return;
    const destination = tilesByKey.get(target);
    if (!destination) return;
    if (tilesByKey.get(key)?.category.toLowerCase() !== destination.category.toLowerCase()) {
      if (canEditTiles) moveToCategory(key, destination.category, target);
      else setMessage('Editing access is required to change a tile’s category.');
      return;
    }
    const order = orderGroupedTiles(tiles, settings.tileOrder).map(tileKey);
    const from = order.indexOf(key);
    const to = order.indexOf(target);
    [order[from], order[to]] = [order[to], order[from]];
    setSelected(key);
    setSettings({ ...settings, tileOrder: order });
    setMessage(`${title(key)} moved within its category.`);
    focusTile.current = key;
  }

  function tileControl(tile: T, position?: Position) {
    const key = tileKey(tile);
    function move(source: string) {
      if (position) place(source, position, key);
      else swapGrouped(source, key);
    }
    return <button type="button" className="layout-piece"
      data-match={highlighted ? matches.has(key) : undefined}
      aria-label={position ? `${tile.title}, row ${position.row + 1}, column ${position.column + 1}` : `Arrange ${tile.title}`}
      aria-description={[tile.category, ...tile.tags].join('. ')}
      aria-pressed={selected === key} draggable
      ref={element => { if (element) buttons.current.set(key, element); else buttons.current.delete(key); }}
      onClick={() => {
        setMessage('');
        if (selected && selected !== key) move(selected);
        else setSelected(selected === key ? '' : key);
      }}
      onDragStart={event => {
        dragged.current = key;
        setSelected(key);
        event.dataTransfer.setData('text/plain', tile.title);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={endDrag}
      onDragOver={event => { if (dragged.current) event.preventDefault(); }}
      onDrop={event => {
        if (!dragged.current) return;
        event.preventDefault();
        event.stopPropagation();
        if (dragged.current !== key) move(dragged.current);
        endDrag();
      }} />;
  }

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
    <div inert={saving}>
    <div className="layout-settings">
      <h2 id="layout-heading">Customize layout</h2>
      <div className="layout-toolbar">
        <label>Layout<select aria-label="Layout" autoFocus value={grouped ? 'categories' : 'custom'} onChange={event => {
          setGrouped(event.target.value === 'categories');
          setSelected('');
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
        {grouped && !preview && selected && <label>Width for {title(selected)}<select aria-label={`Width for ${title(selected)}`}
          value={settings.wideTiles.includes(selected) ? 'full' : 'standard'}
          onChange={event => setSettings({ ...settings, wideTiles: event.target.value === 'full'
            ? [...settings.wideTiles, selected] : settings.wideTiles.filter(key => key !== selected) })}>
          <option value="standard">Standard</option><option value="full">Full row</option>
        </select></label>}
        {canEditTiles && !preview && selectedTile && <label>Move to category
          <select aria-label="Move to category" value="" onChange={event => {
            const destination = categories.get(event.target.value);
            if (destination) moveToCategory(selected, destination);
          }}>
            <option value="">Choose a category</option>
            {categoryOrder.filter(key => key !== selectedTile.category.toLowerCase()).map(key =>
              <option key={key} value={key}>{categoryName(key, categories.get(key)!, settings)}</option>)}
          </select>
        </label>}
        <button type="button" onClick={() => setPreview(value => !value)}>
          {preview ? 'Back to editing' : 'Preview layout'}
        </button>
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
      {preview ? <p className="muted">Layout preview at your current screen size</p> : <>
        <p className="muted">{grouped
          ? canEditTiles
            ? 'Drag a category handle to reorder sections. Drag or select tiles to move them. Moves between sections update the tile’s category.'
            : 'Drag a tile onto another tile in the same category, or select them in order to swap.'
          : 'Drag tiles or select one, then choose an empty cell to move it or another tile to swap. Select it again to deselect.'}</p>
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
          {!grouped && <button type="button" onClick={() => {
            setLayout(groupByCategory(layout, tiles, settings.order));
            setExtraRows(0);
            setMessage('Each category now starts on its own row.');
          }}><Folder size={16} aria-hidden="true" /> Arrange by category</button>}
        </div>
        {highlighted && <p className="muted" role="status">{matches.size} of {tiles.length} tiles match. All tiles stay in place.</p>}
      </>}
    </div>
    {grouped ? renderGroups(tiles, settings, preview ? undefined : tileControl, preview ? undefined : sectionDropProps, preview ? undefined : sectionHandle)
      : preview ? <TileGrid tiles={orderedTiles} layout={layout} categories={categories} settings={settings}
      renderTile={(tile, position) => renderTile(tile, position, settings)} /> : <>
      <div className="custom-layout">
        <div className="grid custom-grid" data-columns={layout.columns}>
          {Array.from({ length: rowCount * layout.columns }, (_, index) => {
            const slot = { row: Math.floor(index / layout.columns), column: index % layout.columns, width: 1 };
            const cell = cells.get(index);
            if (cell && cell.position.column !== slot.column) return null;
            const allowDrop = (event: DragEvent) => { if (dragged.current) event.preventDefault(); };
            if (cell) {
              const { key, position } = cell;
              const tile = tilesByKey.get(key)!;
              const card = renderTile(tile, { ...position, row: gridRow(position.row) }, settings, tileControl(tile, position));
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
      {position && <form className="layout-toolbar layout-coordinate" key={`${selected}:${position.row}:${position.column}`} onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const row = Number(data.get('row')) - 1;
        const column = Number(data.get('column')) - 1;
        const cell = cells.get(row * layout.columns + column);
        place(selected, cell?.position ?? { row, column, width: 1 }, cell?.key);
      }}>
        <label>Row<input name="row" type="number" min="1" max={rowCount} defaultValue={position.row + 1} required /></label>
        <label>Column<input name="column" type="number" min="1" max={layout.columns} defaultValue={position.column + 1} required /></label>
        <button type="submit">Move tile</button>
      </form>}
    </>}
    {message && !preview && <p className="layout-feedback muted" role="status">{message}</p>}
    </div>
    {moves.length > 0 && <p className="layout-feedback muted" role="status">Saving updates the categories of {moves.length} {moves.length === 1 ? 'tile' : 'tiles'} for everyone.</p>}
    <div className="form-actions layout-actions">
      <button type="button" disabled={saving} onClick={onCancel}>Cancel</button>
      <button type="button" className="primary" disabled={saving} onClick={() => onSave(grouped ? null : layout, settings, moves)}>{saving ? 'Saving…' : 'Save layout'}</button>
    </div>
  </section>;
}
