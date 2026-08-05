import { useEffect, useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard, Package, Truck, Calculator, Settings, Building2,
  Users, TrendingUp, ShoppingBag, FileText, Receipt, ClipboardList,
  UserCircle, BookOpen, Wallet, FileSpreadsheet, Landmark, Mail,
  Ship, Boxes, DollarSign, Tags, BarChart2,
  GitMerge, Bot, ScanLine, MessageCircle, Layers, ImageIcon,
  Warehouse, LayoutGrid, PackageSearch, ArrowLeftRight, ClipboardCheck,
  Activity, FlaskConical, GitBranch, RotateCcw, AlertTriangle,
  PackageCheck, FileBarChart2, ShieldCheck, Shield, Calendar,
  Network, Clock, X, Pin, PinOff,
  type LucideIcon,
} from "lucide-react";
import { usePinnedPages } from "@/hooks/usePinnedPages";

interface CommandEntry {
  title: string;
  href: string;
  icon: LucideIcon;
  group: string;
}

export const COMMANDS: CommandEntry[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, group: "Utama" },

  { title: "Settings", href: "/settings", icon: Settings, group: "Utama" },

  { title: "Produk / Bahan Baku", href: "/products/items", icon: PackageSearch, group: "Produk & Recipe" },
  { title: "Recipe / BOM", href: "/products/recipes", icon: FlaskConical, group: "Produk & Recipe" },


  { title: "Sales Dashboard", href: "/sales", icon: LayoutDashboard, group: "Sales" },
  { title: "Sales Items (Master)", href: "/sales/items", icon: Boxes, group: "Sales" },
  { title: "Quotations", href: "/sales/quotations", icon: FileText, group: "Sales" },
  { title: "Sales Orders", href: "/sales/orders", icon: ShoppingBag, group: "Sales" },
  { title: "AI Draft Quotation", href: "/sales/ai-drafts", icon: Bot, group: "Sales" },
  { title: "Customers", href: "/sales/customers", icon: UserCircle, group: "Sales" },
  { title: "Invoices (AR)", href: "/sales/invoices", icon: Receipt, group: "Sales" },

  { title: "Purchase Dashboard", href: "/purchase", icon: LayoutDashboard, group: "Purchase" },
  { title: "Purchase Request (PR)", href: "/purchase/pr", icon: ClipboardList, group: "Purchase" },
  { title: "RFQ / Purchase RFQ", href: "/purchase/rfq", icon: FileText, group: "Purchase" },
  { title: "Purchase Orders (PO)", href: "/purchase/orders", icon: ShoppingBag, group: "Purchase" },
  { title: "Terima Barang (GRN)", href: "/purchase/gr", icon: PackageCheck, group: "Purchase" },
  { title: "QC Inspection", href: "/purchase/qc", icon: ClipboardCheck, group: "Purchase" },
  { title: "Purchase Return", href: "/purchase/returns", icon: RotateCcw, group: "Purchase" },
  { title: "Vendor Invoice (AP)", href: "/purchase/vendor-invoices", icon: Receipt, group: "Purchase" },
  { title: "Bank Disbursement (Bayar Invoice)", href: "/accounting/bank-disbursements?mode=vendor_invoice", icon: Wallet, group: "Purchase" },
  { title: "Landed Cost", href: "/purchase/landed-costs", icon: Calculator, group: "Purchase" },
  { title: "Vendors", href: "/purchase/vendors", icon: UserCircle, group: "Purchase" },

  { title: "Chart of Accounts", href: "/accounting/accounts", icon: Landmark, group: "Accounting" },
  { title: "Jurnal (Journals)", href: "/accounting/journals", icon: BookOpen, group: "Accounting" },
  { title: "Journal Entries", href: "/accounting/entries", icon: FileText, group: "Accounting" },
  { title: "Payments", href: "/accounting/payments", icon: Wallet, group: "Accounting" },
  { title: "Taxes", href: "/accounting/taxes", icon: Receipt, group: "Accounting" },
  { title: "Trial Balance", href: "/accounting/reports/trial-balance", icon: FileSpreadsheet, group: "Accounting" },
  { title: "General Ledger", href: "/accounting/reports/general-ledger", icon: BookOpen, group: "Accounting" },
  { title: "Profit & Loss", href: "/accounting/reports/profit-loss", icon: TrendingUp, group: "Accounting" },
  { title: "Balance Sheet", href: "/accounting/reports/balance-sheet", icon: Wallet, group: "Accounting" },
  { title: "Profitabilitas Freight", href: "/accounting/reports/freight-profitability", icon: Ship, group: "Accounting" },
  { title: "Rekonsiliasi", href: "/accounting/reconciliation", icon: GitMerge, group: "Accounting" },
  { title: "Accounting Settings", href: "/accounting/settings", icon: Settings, group: "Accounting" },
  { title: "Laporan WA Harian", href: "/accounting/wa-report-settings", icon: MessageCircle, group: "Accounting" },
  { title: "Google Sheets Sync", href: "/accounting/gsheet", icon: FileSpreadsheet, group: "Accounting" },

  { title: "Logistic Shipments", href: "/logistics", icon: Truck, group: "Logistics" },
  { title: "Freight Forwarding", href: "/logistics/freight", icon: Ship, group: "Logistics" },
  { title: "Quotation Reply WA", href: "/logistics/quotation-reply", icon: MessageCircle, group: "Logistics" },
  { title: "Performa Driver", href: "/logistics/driver-performance", icon: BarChart2, group: "Logistics" },
  { title: "Request Quote", href: "/logistics/quote-requests", icon: FileText, group: "Logistics" },
  { title: "Portal Orders", href: "/logistics/portal-orders", icon: ClipboardList, group: "Logistics" },

  { title: "Daftar Expense", href: "/expense", icon: Receipt, group: "Expense" },
  { title: "Kategori Expense", href: "/expense/categories", icon: Tags, group: "Expense" },
  { title: "Laporan Expense", href: "/expense/reports", icon: BarChart2, group: "Expense" },

  { title: "Korespondensi", href: "/correspondences", icon: Mail, group: "Komunikasi" },
  { title: "Email Inbox", href: "/email-inbox", icon: MessageCircle, group: "Komunikasi" },

  { title: "AI Chatbot", href: "/settings/ai-chatbot", icon: Bot, group: "AI & Media" },
  { title: "AI Knowledge Base", href: "/settings/ai-chatbot/knowledge", icon: BookOpen, group: "AI & Media" },
  { title: "AI Scan Settings", href: "/settings/ai-scan", icon: ScanLine, group: "AI & Media" },
  { title: "Image Manager", href: "/media", icon: ImageIcon, group: "AI & Media" },

  { title: "Laporan Penjualan B2B", href: "/reports/sales", icon: TrendingUp, group: "Laporan" },
  { title: "Laporan Pembelian", href: "/reports/purchase", icon: ShoppingBag, group: "Laporan" },
  { title: "Valuasi Persediaan", href: "/reports/inventory-valuation", icon: PackageSearch, group: "Laporan" },
  { title: "AR Aging", href: "/reports/ar-aging", icon: Receipt, group: "Laporan" },
  { title: "AP Aging", href: "/reports/ap-aging", icon: FileText, group: "Laporan" },
  { title: "Audit Log Keamanan", href: "/reports/audit-log", icon: Shield, group: "Laporan" },

  { title: "Pengguna", href: "/users", icon: UserCircle, group: "User & Organisasi" },
  { title: "Manajemen Role", href: "/settings/roles", icon: ShieldCheck, group: "User & Organisasi" },
  { title: "Aturan Approval", href: "/settings/approval-rules", icon: ClipboardCheck, group: "User & Organisasi" },
  { title: "Approval Matrix", href: "/settings/approval-matrix", icon: ClipboardCheck, group: "User & Organisasi" },
  { title: "Struktur Organisasi", href: "/org", icon: Network, group: "User & Organisasi" },

  { title: "Holding Companies", href: "/holding", icon: Building2, group: "Holding" },
  { title: "Holding Dashboard", href: "/holding/dashboard", icon: LayoutDashboard, group: "Holding" },
  { title: "Holding P&L Report", href: "/holding/pl-report", icon: TrendingUp, group: "Holding" },


  { title: "Trading", href: "/trading", icon: Package, group: "Lainnya" },
  { title: "Katalog Terpadu", href: "/katalog-terpadu", icon: Layers, group: "Lainnya" },
  { title: "Portal Product Orders", href: "/portal-product-orders", icon: ShoppingBag, group: "Lainnya" },
];

// ── Recent pages storage ─────────────────────────────────────────────────────

export const RECENT_KEY = "bizportal:recent-pages";
export const PINNED_KEY = "bizportal:pinned-pages";
export const RECENT_TIMES_KEY = "bizportal:recent-times";
const MAX_RECENT = 10;

export function readStore(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
}

function writeStore(key: string, val: string[]) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function readRecent(): string[] {
  return readStore(RECENT_KEY);
}

function writeRecent(val: string[]) {
  writeStore(RECENT_KEY, val);
}

function pushRecent(href: string) {
  const known = new Set(COMMANDS.map((c) => c.href));
  if (!known.has(href)) return;
  const prev = readStore(RECENT_KEY).filter((h) => h !== href);
  writeStore(RECENT_KEY, [href, ...prev].slice(0, MAX_RECENT));
  try {
    const times: Record<string, number> = JSON.parse(localStorage.getItem(RECENT_TIMES_KEY) ?? "{}");
    times[href] = Date.now();
    localStorage.setItem(RECENT_TIMES_KEY, JSON.stringify(times));
  } catch {}
}

// ── Page tracker (mount in AppShell) ────────────────────────────────────────

export function usePageTracker() {
  const [location] = useLocation();
  const prevRef = useRef<string | null>(null);
  useEffect(() => {
    if (location !== prevRef.current) {
      prevRef.current = location;
      pushRecent(location);
    }
  }, [location]);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ActionBtn({
  onClick,
  label,
  children,
}: {
  onClick: (e: React.MouseEvent) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="ml-1 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity shrink-0"
      aria-label={label}
    >
      {children}
    </button>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: Props) {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [recentHrefs, setRecentHrefs] = useState<string[]>([]);
  const { pins: pinnedHrefs, togglePin } = usePinnedPages();

  useEffect(() => {
    if (open) {
      setSearch("");
      setRecentHrefs(readRecent());
    }
  }, [open]);

  const handleSelect = useCallback(
    (href: string) => { navigate(href); onOpenChange(false); },
    [navigate, onOpenChange],
  );

  const handleTogglePin = useCallback((href: string, e: React.MouseEvent) => {
    e.stopPropagation();
    togglePin(href);
  }, [togglePin]);

  const removeRecent = useCallback((href: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRecentHrefs((prev) => {
      const next = prev.filter((h) => h !== href);
      writeRecent(next);
      return next;
    });
  }, []);

  const toEntry = (href: string) => COMMANDS.find((c) => c.href === href);

  const pinnedCmds = pinnedHrefs.map(toEntry).filter((c): c is CommandEntry => !!c);
  const recentCmds = recentHrefs
    .filter((h) => !pinnedHrefs.includes(h))
    .map(toEntry)
    .filter((c): c is CommandEntry => !!c);

  const isSearching = search.trim() !== "";
  const showPinned = pinnedCmds.length > 0;
  const showRecent = !isSearching && recentCmds.length > 0;
  const groups = Array.from(new Set(COMMANDS.map((c) => c.group)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 max-w-xl overflow-hidden gap-0" aria-describedby={undefined}>
        <Command className="rounded-lg border-0" shouldFilter={isSearching}>
          <CommandInput
            placeholder="Cari halaman..."
            autoFocus
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-[480px]">
            <CommandEmpty>Halaman tidak ditemukan.</CommandEmpty>

            {/* ── Disematkan ── */}
            {showPinned && (
              <>
                <CommandGroup heading="Disematkan">
                  {pinnedCmds.map((c) => (
                    <CommandItem
                      key={`pinned-${c.href}`}
                      value={`pin ${c.title} ${c.group}`}
                      onSelect={() => handleSelect(c.href)}
                      className="flex items-center gap-2 cursor-pointer group"
                    >
                      <Pin size={13} className="shrink-0 text-primary/80 fill-primary/20" />
                      <c.icon size={14} className="shrink-0 text-muted-foreground" />
                      <span className="flex-1 min-w-0 truncate">{c.title}</span>
                      <span className="text-[10px] text-muted-foreground/50 hidden sm:block shrink-0">
                        {c.group}
                      </span>
                      <ActionBtn onClick={(e) => handleTogglePin(c.href, e)} label="Lepas sematan">
                        <PinOff size={11} />
                      </ActionBtn>
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            {/* ── Terakhir Dikunjungi ── */}
            {showRecent && (
              <>
                <CommandGroup heading="Terakhir Dikunjungi">
                  {recentCmds.map((c) => (
                    <CommandItem
                      key={`recent-${c.href}`}
                      value={`recent ${c.title} ${c.group}`}
                      onSelect={() => handleSelect(c.href)}
                      className="flex items-center gap-2 cursor-pointer group"
                    >
                      <Clock size={13} className="shrink-0 text-muted-foreground/60" />
                      <c.icon size={14} className="shrink-0 text-muted-foreground" />
                      <span className="flex-1 min-w-0 truncate">{c.title}</span>
                      <span className="text-[10px] text-muted-foreground/50 hidden sm:block shrink-0 pr-1">
                        {c.group}
                      </span>
                      <ActionBtn onClick={(e) => handleTogglePin(c.href, e)} label="Sematkan halaman">
                        <Pin size={11} />
                      </ActionBtn>
                      <ActionBtn onClick={(e) => removeRecent(c.href, e)} label="Hapus dari riwayat">
                        <X size={11} />
                      </ActionBtn>
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            {/* ── Semua Halaman ── */}
            {groups.map((group, gi) => (
              <span key={group}>
                {gi > 0 && <CommandSeparator />}
                <CommandGroup heading={group}>
                  {COMMANDS.filter((c) => c.group === group).map((c) => {
                    const pinned = pinnedHrefs.includes(c.href);
                    return (
                      <CommandItem
                        key={c.href}
                        value={`${c.title} ${c.group}`}
                        onSelect={() => handleSelect(c.href)}
                        className="flex items-center gap-2 cursor-pointer group"
                      >
                        <c.icon size={15} className="shrink-0 text-muted-foreground" />
                        <span className="flex-1 min-w-0 truncate">{c.title}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground/60 hidden sm:block shrink-0">
                          {c.href}
                        </span>
                        <ActionBtn
                          onClick={(e) => handleTogglePin(c.href, e)}
                          label={pinned ? "Lepas sematan" : "Sematkan halaman"}
                        >
                          {pinned
                            ? <Pin size={11} className="text-primary fill-primary/30" />
                            : <Pin size={11} />}
                        </ActionBtn>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </span>
            ))}
          </CommandList>

          {/* ── Footer hint ── */}
          <div className="border-t border-border px-3 py-2 flex items-center gap-3 text-[10px] text-muted-foreground/60">
            <span><kbd className="font-mono bg-muted px-1 py-0.5 rounded text-[9px] border border-border">↑↓</kbd> navigasi</span>
            <span><kbd className="font-mono bg-muted px-1 py-0.5 rounded text-[9px] border border-border">↵</kbd> buka</span>
            <span><kbd className="font-mono bg-muted px-1 py-0.5 rounded text-[9px] border border-border">Esc</kbd> tutup</span>
            <span className="ml-auto flex items-center gap-1">
              <Pin size={9} /> hover item untuk sematkan
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

// ── useCommandPalette ────────────────────────────────────────────────────────

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return { open, setOpen };
}
