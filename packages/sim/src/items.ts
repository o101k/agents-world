import type { ItemName } from '@aw/shared';

/** How much hunger each item satisfies (food points, out of 100). */
export const NUTRITION: Record<ItemName, number> = {
  berries: 8,
  vegetables: 18,
  fish: 25,
  bread: 30,
};

export const FOOD_ITEMS = Object.keys(NUTRITION) as ItemName[];

export function isItemName(s: string): s is ItemName {
  return s in NUTRITION;
}
