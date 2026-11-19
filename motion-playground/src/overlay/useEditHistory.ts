import { useCallback, useRef } from "react";

/** Consecutive slider changes share one undo step. A new edit always clears redo. */
export function useEditHistory<T>(value: T, apply: (value: T) => void) {
  const snapshot = useRef(value);
  const applyRef = useRef(apply);
  snapshot.current = value;
  applyRef.current = apply;
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const last = useRef(-Infinity);

  const pushHistory = useCallback((force = false) => {
    const now = performance.now();
    future.current = [];
    if (!force && now - last.current < 400) {
      last.current = now;
      return;
    }
    last.current = force ? -Infinity : now;
    past.current.push(structuredClone(snapshot.current));
    if (past.current.length > 50) past.current.shift();
  }, []);

  const undo = useCallback(() => {
    if (!past.current.length) return;
    future.current.push(structuredClone(snapshot.current));
    last.current = -Infinity;
    applyRef.current(past.current.pop()!);
  }, []);

  const redo = useCallback(() => {
    if (!future.current.length) return;
    past.current.push(structuredClone(snapshot.current));
    last.current = -Infinity;
    applyRef.current(future.current.pop()!);
  }, []);

  return { pushHistory, undo, redo, undoRef: past };
}
