import { useId, useState } from 'react';

export function ImportCategory({ categories, value, disabled, onChange }: {
  categories: string[]; value: string; disabled: boolean; onChange: (value: string) => void;
}) {
  const id = useId();
  const [creating, setCreating] = useState(false);
  const options = [...new Set([value, ...categories])].filter(Boolean).sort((a, b) => a.localeCompare(b));
  return <div className="category-picker">
    <label htmlFor={id}>Category</label><select id={id} value={creating ? '' : value} disabled={disabled} onChange={event => {
      setCreating(event.target.value === ''); onChange(event.target.value);
    }}>
      {options.map(category => <option key={category}>{category}</option>)}
      <option value="">Create a category...</option>
    </select>
    {creating && <label>New category<input value={value} required disabled={disabled} maxLength={40} autoComplete="off" onChange={event => onChange(event.target.value)} /></label>}
  </div>;
}
