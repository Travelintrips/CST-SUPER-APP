import { useCallback } from "react";
import { useQueryClient, skipToken } from "@tanstack/react-query";
import type { QueryFunction, QueryKey } from "@tanstack/react-query";

export interface PrefetchOptions {
  queryKey: QueryKey;
  queryFn?: QueryFunction<unknown> | typeof skipToken;
}

export function usePrefetchOnHover(delay = 150) {
  const queryClient = useQueryClient();

  return useCallback(
    (opts: PrefetchOptions) => {
      let timerId: ReturnType<typeof setTimeout> | null = null;

      const onMouseEnter = () => {
        if (!opts.queryFn) return;
        timerId = setTimeout(() => {
          queryClient.prefetchQuery(opts as { queryKey: QueryKey; queryFn: QueryFunction<unknown> });
        }, delay);
      };

      const onMouseLeave = () => {
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
      };

      return { onMouseEnter, onMouseLeave };
    },
    [queryClient, delay],
  );
}
