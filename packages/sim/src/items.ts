import { FOOD_ITEMS, ITEMS, ITEM_NAMES, type ItemName } from '@aw/shared';

/** How much hunger each item satisfies (food points, out of 100). */
export const NUTRITION: Record<ItemName, number> = Object.fromEntries(
  ITEM_NAMES.map((i) => [i, ITEMS[i].nutrition]),
) as Record<ItemName, number>;

export { FOOD_ITEMS };

export function isItemName(s: string): s is ItemName {
  return s in ITEMS;
}

export function isFood(item: ItemName): boolean {
  return ITEMS[item].nutrition > 0;
}
