"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Run a save, and report its state back to the button that started it.
 *
 * The problem this solves: a mechanic taps "Add part", the save takes a moment
 * over the shop wifi, nothing on screen changes, so they tap again — and a
 * stocked part gets drawn off the shelf twice. Press illumination (globals.css)
 * says "your tap landed". This says "it actually saved", and blocks the second
 * tap while the first is still in flight.
 *
 * Usage:
 *   const add = useActionFlash(addPart);
 *   <form onSubmit={add.run}>
 *     <button disabled={add.busy} className={`${base} ${add.className}`}>
 *       {add.label("Add part")}
 *     </button>
 *
 * The wrapped function should return false (or throw) when it fails, so a
 * failure never shows a tick. Returning undefined counts as success, which
 * keeps existing handlers working unchanged.
 */
export function useActionFlash(fn, { holdMs = 1600 } = {}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const timer = useRef(null);
  const alive = useRef(true);
  // The double-tap guard is a ref, not the `busy` state, deliberately. Two taps
  // landing in the same tick would BOTH read the old `busy === false` from their
  // closure and both fire — which is the exact bug this hook exists to prevent.
  // A ref updates synchronously, so the second tap always sees the first.
  const running = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const run = useCallback(
    async (...args) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setDone(false);
      try {
        const result = await fn(...args);
        if (result === false) return result; // handler reported a failure
        if (!alive.current) return result;
        if (timer.current) clearTimeout(timer.current);
        setDone(true);
        timer.current = setTimeout(() => {
          if (alive.current) setDone(false);
        }, holdMs);
        return result;
      } finally {
        running.current = false;
        if (alive.current) setBusy(false);
      }
    },
    [fn, holdMs]
  );

  // The label the button should show right now.
  const label = useCallback(
    (idle, { working = "Saving…", ok = "✓ Added" } = {}) => (busy ? working : done ? ok : idle),
    [busy, done]
  );

  // Appended to the button's own classes. Green only while confirming.
  // The ! prefixes override the button's own bg/border utilities for the moment
  // the tick is showing, then fall away.
  const className = done ? "!bg-emerald-600 !border-emerald-600 !text-white" : "";

  return { run, busy, done, label, className };
}
