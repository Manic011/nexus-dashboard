import { useRef } from 'react';
import { Plus, X } from 'lucide-react';

type Preset = { label: string; value: string };

export function ScanField({ label, value, placeholder, presets, disabled, onChange }: {
  label: string; value: string[]; placeholder: string; presets: Preset[]; disabled: boolean; onChange: (value: string[]) => void;
}) {
  const addFocus = useRef(false);
  return <fieldset className="scan-section">
    <legend>{label}</legend>
    {value.map((entry, index) => {
      const rowLabel = index === 0 ? label : label + ' ' + (index + 1);
      return <div className="scan-field" key={index}>
        <input aria-label={rowLabel} value={entry} placeholder={index === 0 ? placeholder : 'Enter another value'}
          disabled={disabled} maxLength={2000}
          ref={element => {
            if (element && addFocus.current && index === value.length - 1) {
              addFocus.current = false;
              element.focus();
            }
          }}
          onChange={event => onChange(value.map((item, row) => row === index ? event.target.value : item))} />
        <select aria-label={rowLabel + ' preset'} disabled={disabled}
          value={presets.findIndex(preset => preset.value === entry)}
          onChange={event => {
            const preset = presets[Number(event.target.value)];
            if (preset) onChange(value.map((item, row) => row === index ? preset.value : item));
          }}>
          <option value={-1} disabled>Custom</option>
          {presets.map((preset, option) => <option key={preset.label} value={option}>{preset.label}</option>)}
        </select>
        {value.length > 1 && <button type="button" aria-label={'Remove ' + rowLabel} disabled={disabled}
          onClick={() => onChange(value.filter((_, row) => index !== row))}><X size={16} /></button>}
      </div>;
    })}
    <button type="button" aria-label={'Add entry for ' + label} disabled={disabled} onClick={() => {
      addFocus.current = true;
      onChange([...value, '']);
    }}><Plus size={16} /> Add entry</button>
  </fieldset>;
}
