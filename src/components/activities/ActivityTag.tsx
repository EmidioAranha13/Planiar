import { textColorForBackground } from '../../domain/rules/color';
import { cn } from '../../lib/utils';

export function ActivityTag({
  title,
  color,
  className,
}: {
  title: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      className={cn('inline-flex max-w-full items-center rounded-md px-2 py-0.5 text-xs font-semibold', className)}
      style={{ backgroundColor: color, color: textColorForBackground(color) }}
    >
      <span className="truncate">{title}</span>
    </span>
  );
}
