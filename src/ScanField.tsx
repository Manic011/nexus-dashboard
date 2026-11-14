type Preset = { label: string; value: string };

export function ScanField({ label, value, placeholder, presets, disabled, onChange }: {
  label: string; value: string; placeholder: string; presets: Preset[]; disabled: boolean; onChange: (value: string) => void;
}) {
  const selected = presets.findIndex(preset => preset.value === value);
  return <div className="scan-field">
    <label>{label}<input value={value} placeholder={placeholder} disabled={disabled} maxLength={2000}
      onChange={event => onChange(event.target.value)} /></label>
    <select aria-label={label + ' preset'} disabled={disabled} value={selected} onChange={event => {
      const preset = presets[Number(event.target.value)];
      if (preset) onChange(preset.value);
    }}>
      <option value={-1} disabled>Custom</option>
      {presets.map((preset, index) => <option key={preset.label} value={index}>{preset.label}</option>)}
    </select>
  </div>;
}
