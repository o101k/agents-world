import { describe, expect, it } from 'vitest';
import { usageLine } from './objectHistory.ts';

describe('usageLine', () => {
  it('is null when nobody has used the object', () => {
    expect(usageLine(0, [])).toBeNull();
  });

  it('describes a single use', () => {
    expect(usageLine(1, [{ id: 'a', name: 'Ana Smith', count: 1 }])).toBe(
      'Used once · by Ana Smith',
    );
    expect(usageLine(1, [])).toBe('Used once');
  });

  it('lists the most frequent users', () => {
    expect(
      usageLine(42, [
        { id: 'a', name: 'Ana Smith', count: 12 },
        { id: 'b', name: 'Bo Smith', count: 9 },
      ]),
    ).toBe('Used 42 times · most by Ana Smith (12), Bo Smith (9)');
  });

  it('omits the users when none are listed', () => {
    expect(usageLine(3, [])).toBe('Used 3 times');
  });
});
