import { ITEMS, ITEM_NAMES, type ItemName } from '@aw/shared';

/** The town market: not a person, just a stall with stock whose prices follow supply and demand. */
export interface MarketState {
  stock: Record<ItemName, number>;
}

/** Stock level at which an item sells for its base price. */
export const MARKET_TARGET: Record<ItemName, number> = {
  berries: 20,
  vegetables: 20,
  fish: 15,
  bread: 15,
  wheat: 20,
  wood: 20,
  planks: 10,
  tools: 4,
};

export function initialMarket(): MarketState {
  return {
    stock: Object.fromEntries(ITEM_NAMES.map((i) => [i, MARKET_TARGET[i]])) as Record<
      ItemName,
      number
    >,
  };
}

export interface Quote {
  /** What you pay the market per unit. */
  buy: number;
  /** What the market pays you per unit. */
  sell: number;
}

/** Scarce goods cost more; gluts sell for less. Coins are whole numbers. */
export function quote(market: MarketState, item: ItemName): Quote {
  const target = MARKET_TARGET[item];
  const stock = market.stock[item] ?? 0;
  const factor = Math.min(2, Math.max(0.5, 1.6 - (0.6 * stock) / target));
  const price = ITEMS[item].basePrice * factor;
  const sell = Math.max(1, Math.floor(price * 0.85));
  const buy = Math.max(sell + 1, Math.ceil(price * 1.15));
  return { buy, sell };
}

export function allQuotes(market: MarketState): Record<ItemName, Quote> {
  return Object.fromEntries(ITEM_NAMES.map((i) => [i, quote(market, i)])) as Record<
    ItemName,
    Quote
  >;
}

/** Once a day, traders from elsewhere move 30% of the gap back toward normal stock. */
export function driftMarket(market: MarketState): void {
  for (const item of ITEM_NAMES) {
    const s = market.stock[item] ?? 0;
    market.stock[item] = Math.round(s + (MARKET_TARGET[item] - s) * 0.3);
  }
}
