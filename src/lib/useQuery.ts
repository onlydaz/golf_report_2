import { useEffect, useMemo, useState } from "react";
import { errorText } from "./db";

/** Re-run a query when its inputs change; keeps the last good data while reloading. */
export function useQuery<T>(enabled: boolean, run: () => Promise<T>, deps: unknown[], keepPreviousData = true) {
  const key = useMemo(() => ({}), [enabled, ...deps]);
  const [state, setState] = useState<{ key: object; data?: T; error: string; loading: boolean }>();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState((s) => ({ key, data: keepPreviousData ? s?.data : undefined, error: "", loading: true }));
    run()
      .then((v) => {
        if (!active) return;
        setState({ key, data: v, error: "", loading: false });
      })
      .catch((e) => active && setState((s) => ({ key, data: keepPreviousData ? s?.data : undefined, error: errorText(e), loading: false })));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return {
    data: keepPreviousData || (enabled && state?.key === key) ? state?.data : undefined,
    error: state?.key === key ? state.error : "",
    loading: enabled && (state?.key !== key || state.loading),
  };
}
