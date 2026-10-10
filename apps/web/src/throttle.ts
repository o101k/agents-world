/**
 * Runs `fn` at most once per `ms`, and never drops the last call. A trigger that comes long
 * after the previous run runs `fn` at once (leading edge). Triggers that come sooner schedule a
 * single run for when `ms` has passed (trailing edge); further triggers before then do nothing,
 * since that run reads whatever the latest state is.
 */
export function createThrottle(
  fn: () => void,
  ms: number,
  now: () => number = () => performance.now(),
): { trigger(): void; cancel(): void } {
  let lastRun = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = () => {
    timer = null;
    lastRun = now();
    fn();
  };

  return {
    trigger() {
      if (timer !== null) return; // a trailing run is already scheduled and will see the change
      const wait = lastRun + ms - now();
      if (wait <= 0) run();
      else timer = setTimeout(run, wait);
    },
    /** Drops a scheduled trailing run (e.g. when the component using it unmounts). */
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
