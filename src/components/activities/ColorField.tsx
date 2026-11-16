import { HexColorPicker } from 'react-colorful';
import { hexToRgb, rgbToHex } from '../../domain/rules/color';
import { ActivityTag } from './ActivityTag';
import { Input, Label } from '../ui/field';

export function ColorField({
  color,
  onChange,
  label = 'Cor',
  preview,
}: {
  color: string;
  onChange: (color: string) => void;
  label?: string;
  preview?: string;
}) {
  const rgb = hexToRgb(color) ?? { r: 15, g: 118, b: 110 };
  const updateChannel = (channel: 'r' | 'g' | 'b', value: string) => {
    const next = { ...rgb, [channel]: Number(value) };
    if ([next.r, next.g, next.b].some((item) => Number.isNaN(item))) return;
    onChange(rgbToHex(next.r, next.g, next.b));
  };

  return (
    <div className="space-y-3">
      <Label>{label}</Label>
      <HexColorPicker color={color} onChange={(value) => onChange(value.toUpperCase())} />
      <div className="grid grid-cols-[1fr_repeat(3,4.5rem)] gap-2">
        <Input aria-label="Hexadecimal" value={color} onChange={(event) => onChange(event.target.value.toUpperCase())} />
        {(['r', 'g', 'b'] as const).map((channel) => (
          <Input
            key={channel}
            aria-label={channel.toUpperCase()}
            inputMode="numeric"
            value={rgb[channel]}
            onChange={(event) => updateChannel(channel, event.target.value)}
          />
        ))}
      </div>
      {preview ? <ActivityTag title={preview} color={hexToRgb(color) ? color : '#0F766E'} /> : null}
    </div>
  );
}
