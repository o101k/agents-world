import { useCallback, useEffect, useRef, useState } from 'react';
import {
  STAGE_LABELS,
  type BrainConfig,
  type BrainsResponse,
  type WorldSettings,
} from '@aw/shared';
import { api } from '../api.ts';
import { BrainsModal, type BrainsModalRow } from './BrainsModal.tsx';

/** Shown for the instant before the first answer arrives. */
const PLACEHOLDER: BrainConfig = { provider: 'mock', model: '', effort: 'frugal' };

/**
 * Observer power: see what each villager's AI has spent and change who thinks with what, one
 * person or many at once. Nobody's decisions are touched; only the model behind them.
 */
export function WorldBrainsDialog({
  worldId,
  onClose,
  onSettingsUpdated,
}: {
  worldId: string;
  onClose: () => void;
  onSettingsUpdated?: (settings: WorldSettings) => void;
}) {
  const [data, setData] = useState<BrainsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const latest = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const next = await api.brains(worldId);
      if (mounted.current && mine === latest.current) {
        setData(next);
        setLoadError(null);
      }
    } catch (e) {
      if (mounted.current && mine === latest.current) setLoadError((e as Error).message);
    }
  }, [worldId]);

  // Numbers move while the world runs, so keep them fresh while the dialog is open.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(() => void tick(), 3000);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [refresh]);

  const rows: BrainsModalRow[] = (data?.people ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    detail: p.alive
      ? `${STAGE_LABELS[p.stage]}, ${Math.floor(p.age)}`
      : `Dead · ${STAGE_LABELS[p.stage]}`,
    stage: p.stage,
    alive: p.alive,
    brain: p.brain,
    usage: p,
  }));

  return (
    <BrainsModal
      title="Brains and spending"
      intro="Who thinks with which AI, and what each person has used so far. A change takes effect the next time that person decides something."
      people={rows}
      defaultBrain={data?.defaultBrain ?? PLACEHOLDER}
      showUsage
      totals={data?.totals}
      loading={!data && !loadError}
      loadError={data ? null : loadError}
      onApply={async (ids, brain) => {
        const next = await api.setBrains(worldId, { agentIds: ids, brain });
        latest.current++;
        if (mounted.current) setData(next);
      }}
      onApplyDefault={async (brain) => {
        const settings = await api.setDefaultBrain(worldId, brain, false);
        onSettingsUpdated?.(settings);
        await refresh();
      }}
      primaryLabel="Done"
      onPrimary={onClose}
      onClose={onClose}
    />
  );
}
