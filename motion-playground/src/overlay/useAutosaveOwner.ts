import { useEffect, useState } from "react";
/** One editor owns recovery and disk autosave; other tabs can still export explicit copies. */
export function useAutosaveOwner() {
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let release = () => {};
    if (!navigator.locks) return;
    queueMicrotask(() => {
      if (cancelled) return;
      void navigator.locks.request(
        "overlay-studio-autosave",
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (cancelled || !lock) return;
          setOwner(true);
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      );
    });
    return () => {
      cancelled = true;
      release();
    };
  }, []);
  return owner;
}
