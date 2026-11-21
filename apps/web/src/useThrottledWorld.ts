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
  const renderedRef = useRef(value);
  // Callers pass inline selectors, so the latest one is kept in a ref instead of as a dependency.
  const selectRef = useRef(select);
  useEffect(() => {
    selectRef.current = select;
    renderedRef.current = value;
  });
  useEffect(() => {
    const current = () => selectRef.current(useWorld.getState());
    let last = current();
    const throttle = createThrottle(() => setValue(() => current()), ms);
    const unsubscribe = useWorld.subscribe((state) => {
      const next = selectRef.current(state);
      if (Object.is(next, last)) return;
      last = next;
      throttle.trigger();
    });
    // Only trigger if the store actually changed between initial render and subscribe.
    if (!Object.is(last, renderedRef.current)) throttle.trigger();
    return () => {
      unsubscribe();
      throttle.cancel();
    };
  }, [ms]);
  return value;
}
