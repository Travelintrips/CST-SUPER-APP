import { useState, useEffect, useRef } from "react";
import { UserRoundCog } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

type DevUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  ecommerce: "Ecommerce",
  trading: "Trading",
  logistics: "Logistics",
  other: "Lainnya",
};

const ROLE_ORDER = ["admin", "ecommerce", "trading", "logistics"];

export function DevUserSwitcher() {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<DevUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    fetch("/api/dev-users")
      .then((r) => r.ok ? r.json() : { users: [] })
      .then((d: { users: DevUser[] }) => setUsers(d.users ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const grouped = users.reduce<Record<string, DevUser[]>>((acc, u) => {
    const r = u.role ?? "other";
    if (!acc[r]) acc[r] = [];
    acc[r].push(u);
    return acc;
  }, {});

  const roleOrder = [...ROLE_ORDER, ...Object.keys(grouped).filter((r) => !ROLE_ORDER.includes(r))];

  async function switchUser(email: string) {
    setSwitching(email);
    setLoading(true);
    try {
      await fetch("/api/dev-login?redirect=/bizportal/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email }).toString(),
        credentials: "include",
        redirect: "manual",
      });
      qc.clear();
      window.location.href = "/bizportal/";
    } catch {
      setLoading(false);
      setSwitching(null);
    }
  }

  if (users.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-amber-600/50 bg-amber-950/30 px-2 py-1 text-[11px] font-mono font-semibold text-amber-400 hover:bg-amber-950/50 transition-colors"
        title="Dev: ganti user aktif"
        disabled={loading}
      >
        <UserRoundCog size={13} />
        <span className="hidden sm:inline">DEV</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[260px] rounded-lg border border-border bg-popover shadow-xl overflow-hidden">
          <div className="border-b border-border bg-amber-950/20 px-3 py-2">
            <p className="text-[11px] font-mono font-semibold text-amber-400">Impersonate User (DEV)</p>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {roleOrder.filter((r) => grouped[r]?.length).map((role) => (
              <div key={role}>
                <div className="sticky top-0 bg-muted/80 backdrop-blur-sm px-3 py-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {ROLE_LABELS[role] ?? role}
                  </span>
                </div>
                {grouped[role].map((u) => {
                  const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
                  const isSwitching = switching === u.email;
                  return (
                    <button
                      key={u.id}
                      onClick={() => switchUser(u.email)}
                      disabled={loading}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
                        {(name ?? "?").substring(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium leading-none">{name}</p>
                        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{u.email}</p>
                      </div>
                      {isSwitching && (
                        <div className="h-3 w-3 animate-spin rounded-full border border-primary border-t-transparent shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
