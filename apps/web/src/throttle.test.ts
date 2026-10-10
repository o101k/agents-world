import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThrottle } from './throttle.ts';

describe('createThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the first trigger at once', () => {
    const fn = vi.fn();
    const t = createThrottle(fn, 250, () => Date.now());
    t.trigger();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs once more at the end of the window for triggers inside it', () => {
    const fn = vi.fn();
    const t = createThrottle(fn, 250, () => Date.now());
    t.trigger(); // leading run
    t.trigger();
    t.trigger();
    t.trigger();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(249);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2); // the trailing run, once
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2); // nothing more was asked for
  });

  it('runs at once for a trigger after the window has passed', () => {
    const fn = vi.fn();
    const t = createThrottle(fn, 250, () => Date.now());
    t.trigger();
    vi.advanceTimersByTime(300);
    t.trigger();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('keeps the window after a trailing run, so the next burst waits too', () => {
    const fn = vi.fn();
    const t = createThrottle(fn, 250, () => Date.now());
    t.trigger(); // t=0, leading
    vi.advanceTimersByTime(100);
    t.trigger(); // t=100, schedules a run for t=250
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(2); // trailing run at t=250
    t.trigger(); // t=250, inside the new window
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(3); // t=500
  });

  it('cancel stops a scheduled run', () => {
    const fn = vi.fn();
    const t = createThrottle(fn, 250, () => Date.now());
    t.trigger();
    t.trigger(); // scheduled
    t.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('after cancel, a trigger inside the window is scheduled again', () => {
    const fn = vi.fn();
    const t = createThrottle(fn, 250, () => Date.now());
    t.trigger();
    t.trigger();
    t.cancel();
    t.trigger(); // still inside the window, so scheduled again
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('cancel with nothing scheduled is harmless', () => {
    const fn = vi.fn();
    const t = createThrottle(fn, 250, () => Date.now());
    expect(() => t.cancel()).not.toThrow();
    t.trigger();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
