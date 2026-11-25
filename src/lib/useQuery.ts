import { useEffect, useState } from "react";
import { errorText } from "./db";

/** Re-run a query when its inputs change; keeps the last good data while reloading. */
export function useQuery<T>(enabled: boolean, run: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setLoading(true);
    run()
      .then((v) => {
        if (!active) return;
        setData(v);
        setError("");
      })
      .catch((e) => active && setError(errorText(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
  return { data, error, loading };
}
