import { useEffect, useRef, useState } from 'react';
import { createThrottle } from './throttle.ts';
import { useWorld } from './worldStore.ts';

type WorldState = ReturnType<typeof useWorld.getState>;

/**
 * The part of the world store that `select` picks, updated at most once per `ms` (a change after
 * a quiet spell lands at once). For lists that don't need every live frame: the component doesn't
 * re-render on each store change in between, and the last change always lands. Anything that must
 * update at once (selection, replay) keeps using `useWorld`.
 */
export function useThrottledWorld<T>(select: (s: WorldState) => T, ms = 250): T {
  const [value, setValue] = useState(() => select(useWorld.getState()));
  // Callers pass inline selectors, so the latest one is kept in a ref instead of as a dependency.
  const selectRef = useRef(select);
  useEffect(() => {
    selectRef.current = select;
  });
  useEffect(() => {
    const current = () => selectRef.current(useWorld.getState());
    let last = current();
    const throttle = createThrottle(() => setValue(current()), ms);
    const unsubscribe = useWorld.subscribe((state) => {
      const next = selectRef.current(state);
      if (Object.is(next, last)) return;
      last = next;
      throttle.trigger();
    });
    // The store may have changed between render and subscribe: a leading run sets the state now.
    throttle.trigger();
    return () => {
      unsubscribe();
      throttle.cancel();
    };
  }, [ms]);
  return value;
}
