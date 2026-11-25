import { useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";

/** Subscribe to several Tauri events once, unsubscribing on unmount. */
export function useEvents(subscribe: () => Promise<UnlistenFn>[]) {
  useEffect(() => {
    let cancelled = false;
    const unlistens: UnlistenFn[] = [];
    subscribe().forEach((p) => p.then((u) => (cancelled ? u() : unlistens.push(u))));
    return () => {
      cancelled = true;
      unlistens.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
