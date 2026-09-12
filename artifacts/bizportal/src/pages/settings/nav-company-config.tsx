import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { ArrowLeft, LayoutGrid, RotateCcw, Save, Building2 } from "lucide-react";
import { Link } from "wouter";

type NavCompanyConfig = Record<string, string[]>;

interface ConfigItem {
  title: string;
  href: string;
  defaultCodes: string[];
}
interface ConfigModule {
  module: string;
  items: ConfigItem[];
}

const HOLDING_SENTINEL = "__holding__";

const CONFIGURABLE_NAV: ConfigModule[] = [
  {
    module: "Sales",
    items: [
      { title: "Dashboard Sales", href: "/sales", defaultCodes: [] },
      { title: "Master Item", href: "/sales/items", defaultCodes: [] },
      { title: "Quotation", href: "/sales/quotations", defaultCodes: [] },
      { title: "Sales Order", href: "/sales/orders", defaultCodes: [] },
      { title: "AI Draft Quotation", href: "/sales/ai-drafts", defaultCodes: [] },
      { title: "Pelanggan", href: "/sales/customers", defaultCodes: [] },
      { title: "Invoice", href: "/sales/invoices", defaultCodes: [] },
      { title: "Portal Product Orders", href: "/portal-product-orders", defaultCodes: ["CST"] },
    ],
  },
  {
    module: "Purchase",
    items: [
      { title: "Dashboard Purchase", href: "/purchase", defaultCodes: [] },
      { title: "Purchase Request (PR)", href: "/purchase/pr", defaultCodes: [] },
      { title: "RFQ", href: "/purchase/rfq", defaultCodes: [] },
      { title: "Purchase Order", href: "/purchase/orders", defaultCodes: [] },
      { title: "Terima Barang (GRN)", href: "/purchase/gr", defaultCodes: [] },
      { title: "QC Inspection", href: "/purchase/qc", defaultCodes: [] },
      { title: "Purchase Return", href: "/purchase/returns", defaultCodes: [] },
      { title: "Vendor Invoice (AP)", href: "/purchase/vendor-invoices", defaultCodes: [] },
      { title: "Payment Request", href: "/purchase/payment-requests", defaultCodes: [] },
      { title: "Landed Cost", href: "/purchase/landed-costs", defaultCodes: [] },
      { title: "Vendors", href: "/purchase/vendors", defaultCodes: [] },
      { title: "Thai Tea Procurement", href: "/purchase/thai-tea", defaultCodes: ["CST"] },
    ],
  },
  {
    module: "Logistics",
    items: [
      { title: "Shipments", href: "/logistics", defaultCodes: [] },
      { title: "Freight Forwarding", href: "/logistics/freight", defaultCodes: ["CST"] },
      { title: "Balasan Quotation WA", href: "/logistics/quotation-reply", defaultCodes: ["CST"] },
      { title: "Performa Driver", href: "/logistics/driver-performance", defaultCodes: ["CST"] },
      { title: "Request Quote", href: "/logistics/quote-requests", defaultCodes: ["CST"] },
      { title: "Portal Orders", href: "/logistics/portal-orders", defaultCodes: ["CST"] },
    ],
  },
  {
    module: "Akunting",
    items: [
      { title: "Bagan Akun", href: "/accounting/accounts", defaultCodes: [] },
      { title: "Jurnal", href: "/accounting/journals", defaultCodes: [] },
      { title: "Jurnal Entry", href: "/accounting/entries", defaultCodes: [] },
      { title: "Pembayaran", href: "/accounting/payments", defaultCodes: [] },
      { title: "Pajak", href: "/accounting/taxes", defaultCodes: [] },
      { title: "Neraca Saldo", href: "/accounting/reports/trial-balance", defaultCodes: [] },
      { title: "Buku Besar", href: "/accounting/reports/general-ledger", defaultCodes: [] },
      { title: "Laba Rugi", href: "/accounting/reports/profit-loss", defaultCodes: [] },
      { title: "Neraca", href: "/accounting/reports/balance-sheet", defaultCodes: [] },
      { title: "Rekonsiliasi", href: "/accounting/reconciliation", defaultCodes: [] },
      { title: "Pengaturan Akunting", href: "/accounting/settings", defaultCodes: [] },
      { title: "Governance & Audit Control", href: "/accounting/governance", defaultCodes: [] },
      { title: "Holding Dashboard", href: "/holding/dashboard", defaultCodes: [HOLDING_SENTINEL] },
      { title: "Holding P&L", href: "/holding/pl-report", defaultCodes: [HOLDING_SENTINEL] },
    ],
  },
  {
    module: "Expense",
    items: [
      { title: "Daftar Expense", href: "/expense", defaultCodes: [] },
      { title: "Kategori Expense", href: "/expense/categories", defaultCodes: [] },
      { title: "Laporan Expense", href: "/expense/reports", defaultCodes: [] },
    ],
  },
];

const MODULE_COLORS: Record<string, string> = {
  Sales: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  Purchase: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  Logistics: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  Akunting: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  Expense: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

function buildDefaults(): NavCompanyConfig {
  const cfg: NavCompanyConfig = {};
  for (const mod of CONFIGURABLE_NAV) {
    for (const item of mod.items) {
      cfg[item.href] = item.defaultCodes;
    }
  }
  return cfg;
}

export default function NavCompanyConfigPage() {
  const { companies } = useCompany();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: savedConfig, isLoading } = useQuery<NavCompanyConfig>({
    queryKey: ["settings", "nav-company-config"],
    queryFn: async () => {
      const res = await fetch("/api/settings/nav-company-config", { credentials: "include" });
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 60_000,
  });

  const [localConfig, setLocalConfig] = useState<NavCompanyConfig>(() => buildDefaults());

  useEffect(() => {
    if (savedConfig) {
      setLocalConfig((prev) => ({ ...buildDefaults(), ...savedConfig, ...prev }));
    }
  }, [savedConfig]);

  useEffect(() => {
    if (savedConfig !== undefined) {
      setLocalConfig({ ...buildDefaults(), ...savedConfig });
    }
  }, [savedConfig]);

  const saveMutation = useMutation({
    mutationFn: async (config: NavCompanyConfig) => {
      const res = await fetch("/api/settings/nav-company-config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error("Gagal menyimpan");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "nav-company-config"] });
      toast({ title: "Tersimpan", description: "Konfigurasi menu berhasil disimpan." });
    },
    onError: () => {
      toast({ title: "Gagal", description: "Terjadi kesalahan saat menyimpan.", variant: "destructive" });
    },
  });

  const getCodes = (href: string): string[] => localConfig[href] ?? [];

  const isAllCompanies = (href: string) => {
    const codes = getCodes(href);
    return codes.length === 0;
  };

  const toggleAll = (href: string) => {
    setLocalConfig((prev) => ({ ...prev, [href]: [] }));
  };

  const toggleCode = (href: string, code: string) => {
    setLocalConfig((prev) => {
      const curr = prev[href] ?? [];
      const next = curr.includes(code)
        ? curr.filter((c) => c !== code)
        : [...curr.filter((c) => c !== HOLDING_SENTINEL), code];
      return { ...prev, [href]: next };
    });
  };

  const toggleHolding = (href: string) => {
    setLocalConfig((prev) => {
      const curr = prev[href] ?? [];
      if (curr.includes(HOLDING_SENTINEL)) {
        return { ...prev, [href]: curr.filter((c) => c !== HOLDING_SENTINEL) };
      }
      return { ...prev, [href]: [HOLDING_SENTINEL] };
    });
  };

  const resetDefaults = () => {
    setLocalConfig(buildDefaults());
  };

  const regularCompanies = companies.filter((c) => !c.isHolding);

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-2xl font-bold flex items-center gap-2">
              <LayoutGrid className="h-6 w-6" />
              Konfigurasi Menu per Perusahaan
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Atur sub-menu modul ERP mana yang tampil untuk setiap perusahaan. Kosong = tampil untuk semua perusahaan.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={resetDefaults}>
              <RotateCcw className="h-4 w-4 mr-1.5" />Reset Default
            </Button>
            <Button size="sm" onClick={() => saveMutation.mutate(localConfig)} disabled={saveMutation.isPending}>
              <Save className="h-4 w-4 mr-1.5" />
              {saveMutation.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <Card><CardContent className="p-6 text-muted-foreground text-sm">Memuat konfigurasi...</CardContent></Card>
        ) : (
          <div className="space-y-4">
            {CONFIGURABLE_NAV.map((mod) => (
              <Card key={mod.module}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${MODULE_COLORS[mod.module] ?? "bg-muted text-muted-foreground"}`}>
                      {mod.module}
                    </span>
                    <span className="text-muted-foreground font-normal text-sm">{mod.items.length} item</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Centang perusahaan yang dapat melihat sub-menu ini. Jika tidak ada yang dicentang = tampil untuk semua perusahaan.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-t border-border bg-muted/30">
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground w-56">Sub-menu</th>
                          <th className="px-3 py-2 font-medium text-muted-foreground text-center whitespace-nowrap">
                            <span className="flex items-center justify-center gap-1">
                              <span className="text-xs">Semua</span>
                            </span>
                          </th>
                          {regularCompanies.map((c) => (
                            <th key={c.id} className="px-3 py-2 font-medium text-muted-foreground text-center whitespace-nowrap">
                              <div className="flex flex-col items-center gap-0.5">
                                <Building2 size={11} className="text-muted-foreground/60" />
                                <span className="text-[11px] font-semibold">{c.companyCode}</span>
                              </div>
                            </th>
                          ))}
                          <th className="px-3 py-2 font-medium text-muted-foreground text-center whitespace-nowrap">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-[9px] font-semibold uppercase text-indigo-500">Holding</span>
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {mod.items.map((item, idx) => {
                          const codes = getCodes(item.href);
                          const allVisible = isAllCompanies(item.href);
                          const holdingOnly = codes.includes(HOLDING_SENTINEL);

                          return (
                            <tr
                              key={item.href}
                              className={`border-t border-border/50 transition-colors hover:bg-muted/20 ${idx % 2 === 0 ? "" : "bg-muted/10"}`}
                            >
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{item.title}</span>
                                  {!allVisible && !holdingOnly && codes.length > 0 && (
                                    <div className="flex gap-1">
                                      {codes.map((c) => (
                                        <Badge key={c} variant="secondary" className="text-[10px] h-4 px-1">
                                          {c}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                  {holdingOnly && (
                                    <Badge variant="outline" className="text-[10px] h-4 px-1 text-indigo-500 border-indigo-300">
                                      Holding
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">{item.href}</div>
                              </td>

                              <td className="px-3 py-2.5 text-center">
                                <Checkbox
                                  checked={allVisible}
                                  onCheckedChange={() => toggleAll(item.href)}
                                  aria-label="Semua perusahaan"
                                  className="data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                                />
                              </td>

                              {regularCompanies.map((c) => (
                                <td key={c.id} className="px-3 py-2.5 text-center">
                                  <Checkbox
                                    checked={!allVisible && !holdingOnly && codes.includes(c.companyCode)}
                                    disabled={allVisible || holdingOnly}
                                    onCheckedChange={() => toggleCode(item.href, c.companyCode)}
                                    aria-label={c.companyCode}
                                  />
                                </td>
                              ))}

                              <td className="px-3 py-2.5 text-center">
                                <Checkbox
                                  checked={holdingOnly}
                                  disabled={allVisible}
                                  onCheckedChange={() => toggleHolding(item.href)}
                                  aria-label="Holding"
                                  className="data-[state=checked]:bg-indigo-500 data-[state=checked]:border-indigo-500"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={resetDefaults}>
            <RotateCcw className="h-4 w-4 mr-1.5" />Reset Default
          </Button>
          <Button size="sm" onClick={() => saveMutation.mutate(localConfig)} disabled={saveMutation.isPending}>
            <Save className="h-4 w-4 mr-1.5" />
            {saveMutation.isPending ? "Menyimpan..." : "Simpan Konfigurasi"}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
