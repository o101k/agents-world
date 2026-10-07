import type { ObjectPerson } from '@aw/shared';

/** "Used 42 times · most by Ana Smith (12), Bo Smith (9)"; null when nobody has used it. */
export function usageLine(
  uses: number,
  regulars: (ObjectPerson & { count: number })[],
): string | null {
  if (uses <= 0) return null;
  if (uses === 1) return regulars[0] ? `Used once · by ${regulars[0].name}` : 'Used once';
  const most = regulars.map((r) => `${r.name} (${r.count})`).join(', ');
  return `Used ${uses} times${most ? ` · most by ${most}` : ''}`;
}
