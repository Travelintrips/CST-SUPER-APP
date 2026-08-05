import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface NavPrefs {
  hiddenItems: string[];
  itemOrder: string[];
  childOrder: Record<string, string[]>;
}

const QUERY_KEY = ["nav-preferences"] as const;

const DEFAULT_PREFS: NavPrefs = { hiddenItems: [], itemOrder: [], childOrder: {} };

async function fetchNavPrefs(): Promise<NavPrefs> {
  const r = await fetch("/api/nav-preferences", { credentials: "include" });
  if (!r.ok) return DEFAULT_PREFS;
  const data = (await r.json()) as Partial<NavPrefs>;
  return {
    hiddenItems: data.hiddenItems ?? [],
    itemOrder: data.itemOrder ?? [],
    childOrder: data.childOrder ?? {},
  };
}

async function saveNavPrefs(prefs: NavPrefs): Promise<void> {
  await fetch("/api/nav-preferences", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
}

export function useNavPreferences() {
  const qc = useQueryClient();

  const { data = DEFAULT_PREFS } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchNavPrefs,
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: saveNavPrefs,
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const prev = qc.getQueryData<NavPrefs>(QUERY_KEY);
      qc.setQueryData(QUERY_KEY, next);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(QUERY_KEY, ctx.prev);
    },
  });

  const save = (next: Partial<NavPrefs>) =>
    mutation.mutate({ ...data, ...next });

  const toggle = (key: string) =>
    save({
      hiddenItems: data.hiddenItems.includes(key)
        ? data.hiddenItems.filter((k) => k !== key)
        : [...data.hiddenItems, key],
    });

  const reorder = (itemOrder: string[]) => save({ itemOrder });

  const reorderChildren = (basePath: string, order: string[]) =>
    save({ childOrder: { ...data.childOrder, [basePath]: order } });

  const reset = () => save({ hiddenItems: [], itemOrder: [], childOrder: {} });

  return {
    hiddenItems: data.hiddenItems,
    itemOrder: data.itemOrder,
    childOrder: data.childOrder,
    toggle,
    reorder,
    reorderChildren,
    reset,
  };
}
