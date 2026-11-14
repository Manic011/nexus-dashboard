import { useState } from 'react';

export function CategoryPicker({ categories, initial }: { categories: string[]; initial: string }) {
  const [selected, setSelected] = useState(initial);
  const options = [...new Set([initial, ...categories])].sort((a, b) => a.localeCompare(b));
  const creating = selected === '';
  return <div className="category-picker">
    <label htmlFor="tile-category">Category</label>
    <select id="tile-category" value={selected} onChange={event => setSelected(event.target.value)}>
      {options.map(category => <option key={category} value={category}>{category}</option>)}
      <option value="">Create a category…</option>
    </select>
    {creating
      ? <label>New category<input name="category" autoComplete="off" placeholder="e.g. Networking" maxLength={40} required /></label>
      : <input type="hidden" name="category" value={selected} />}
  </div>;
}
