import { useEffect, useState } from 'react';
import { ITEM_LABELS, type ItemName, type MarketResponse } from '@aw/shared';
import { api } from '../api.ts';
import { useWorld } from '../worldStore.ts';

/** Live prices and stock at the town market (the observer sees everything; villagers only what they saw). */
export function MarketPanel({ worldId }: { worldId: string }) {
  const [market, setMarket] = useState<MarketResponse | null>(null);
  const hour = useWorld((s) => Math.floor(s.tick / 60));
  useEffect(() => {
    let cancelled = false;
    api
      .market(worldId)
      .then((m) => !cancelled && setMarket(m))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [worldId, hour]);
  if (!market) return <p className="muted small">Loading market…</p>;
  return (
    <div>
      <table className="price-table">
        <thead>
          <tr>
            <th>Good</th>
            <th title="What villagers pay">Buy</th>
            <th title="What the market pays">Sell</th>
            <th>Stock</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(market.quotes).map(([item, q]) => (
            <tr key={item}>
              <td>{ITEM_LABELS[item as ItemName]}</td>
              <td>{q.buy}</td>
              <td>{q.sell}</td>
              <td className="muted">{market.stock[item]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Prices in coins; they rise when stock is low. {market.moneySupply} coins are held by living
        villagers.
      </p>
    </div>
  );
}
