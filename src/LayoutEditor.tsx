import { GripVertical, Plus } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { arrangeTiles, changeColumns, columnOptions, gridPlacement, maxEmptyRows, moveTile, overlaps, tileKey, type LayoutTile, type Position, type TileLayout } from './tileLayout.js';

export function LayoutEditor({ tiles, saved, onSave, onCancel }: {
  tiles: LayoutTile[];
  saved: TileLayout | null;
  onSave: (layout: TileLayout | null) => void;
  onCancel: () => void;
}) {
  const [layout, setLayout] = useState(() => arrangeTiles(tiles, saved));
  const [grouped, setGrouped] = useState(false);
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState('');
  const [extraRows, setExtraRows] = useState(0);
  const dragged = useRef('');
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focusTile = useRef('');
  const names = new Map(tiles.map(tile => [tileKey(tile), tile.title]));
  const position = layout.positions[selected];
  const lastRow = Math.max(0, ...Object.values(layout.positions).map(slot => slot.row));
  const rowCount = lastRow + 2 + extraRows;
  const cells = new Map<number, { key: string; position: Position }>();
  for (const [key, slot] of Object.entries(layout.positions)) {
    for (let column = slot.column; column < slot.column + slot.width; column++) {
      cells.set(slot.row * layout.columns + column, { key, position: slot });
    }
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
    setMessage(`${names.get(key)} moved to row ${destination.row + 1}, column ${destination.column + 1}.`);
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
    setMessage(`${names.get(selected)} now spans ${width} ${width === 1 ? 'column' : 'columns'}.`);
  }

  return <section className="layout-editor" aria-labelledby="layout-heading">
    <h2 id="layout-heading">Customize layout</h2>
    <div className="layout-toolbar">
      <label>Layout<select aria-label="Layout" autoFocus value={grouped ? 'categories' : 'custom'} onChange={event => {
        setGrouped(event.target.value === 'categories');
        setMessage('');
      }}>
        <option value="custom">Custom grid</option><option value="categories">Grouped by category</option>
      </select></label>
      {!grouped && <>
        <label>Columns<select aria-label="Columns" value={layout.columns} onChange={event => {
          setLayout(changeColumns(layout, Number(event.target.value)));
          setExtraRows(0);
          setMessage('Tiles were packed in their current order to fit the new column count.');
        }}>{columnOptions.map(count => <option key={count}>{count}</option>)}</select></label>
        {position && <label>Width for {names.get(selected)}<select aria-label={`Width for ${names.get(selected)}`} value={position.width} onChange={event => resize(Number(event.target.value))}>
          {columnOptions.filter(count => count <= layout.columns).map(count => <option key={count} value={count}>{count} {count === 1 ? 'column' : 'columns'}</option>)}
        </select></label>}
      </>}
    </div>
    {grouped ? <p className="muted">Saving will return your dashboard to automatic category sections.</p> : <>
      <p className="muted">Drag tiles or select one, then choose an empty cell to move it or another tile to swap. Select it again to deselect. Narrow screens display tiles in row order.</p>
      <div className="layout-scroll">
        <div className="layout-board" style={{ '--columns': layout.columns } as React.CSSProperties}>
          {Array.from({ length: rowCount * layout.columns }, (_, index) => {
            const slot = { row: Math.floor(index / layout.columns), column: index % layout.columns, width: 1 };
            const cell = cells.get(index);
            if (cell && cell.position.column !== slot.column) return null;
            const allowDrop = (event: DragEvent) => { if (dragged.current) event.preventDefault(); };
            if (cell) {
              const { key, position } = cell;
              return <button type="button" key={key} className="layout-piece" style={gridPlacement(position)}
                aria-label={`${names.get(key)}, row ${position.row + 1}, column ${position.column + 1}`}
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
                  event.dataTransfer.setData('text/plain', names.get(key) ?? '');
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => { dragged.current = ''; }}
                onDragOver={allowDrop} onDrop={event => drop(event, position, key)}>
                <GripVertical size={15} aria-hidden="true" /><span>{names.get(key)}</span>
              </button>;
            }
            return <button type="button" key={index} className="layout-slot" style={gridPlacement(slot)}
              aria-label={`Empty cell, row ${slot.row + 1}, column ${slot.column + 1}`}
              tabIndex={selected ? 0 : -1} aria-disabled={!selected}
              onClick={() => { if (selected) place(selected, slot); }}
              onDragOver={allowDrop} onDrop={event => drop(event, slot)}>
              <Plus size={16} aria-hidden="true" />
            </button>;
          })}
        </div>
      </div>
      <button type="button" disabled={extraRows >= maxEmptyRows} onClick={() => setExtraRows(extraRows + 1)}><Plus size={16} /> Add row</button>
    </>}
    <p className="layout-feedback muted" role="status">{message}</p>
    <div className="form-actions layout-actions">
      <button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" className="primary" onClick={() => onSave(grouped ? null : layout)}>Save layout</button>
    </div>
  </section>;
}
