import { ReactNode, useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { CommandPalette, useCommandPalette, usePageTracker } from "@/components/CommandPalette";
import { Link, useLocation } from "wouter";
import { useGetCurrentUser, getGetCurrentUserQueryKey, useListAiDraftQuotations, getListAiDraftQuotationsQueryKey } from "@workspace/api-client-react";
import {
  LayoutDashboard,
  Package,
  Truck,
  Settings,
  LogOut,
  Building2,
  Users,
  ChevronRight,
  ChevronDown,
  TrendingUp,
  ShoppingBag,
  FileText,
  Receipt,
  ClipboardList,
  BookOpen,
  Wallet,
  Landmark,
  DollarSign,
  Tags,
  BarChart2,
  List,
  GitMerge,
  Bot,
  MessageCircle,
  LayoutGrid,
  ArrowLeftRight,
  ClipboardCheck,
  GitBranch,
  ShieldCheck,
  Shield,
  ShieldAlert,
  Database,
  Search,
  Eye,
  EyeOff,
  SlidersHorizontal,
  Link2,
  Lock,
  Brain,
  Trophy,
  Store,
  CreditCard,
  Upload,
  ArrowUpRight,
  ArrowDownLeft,
  Globe,
  MessageSquarePlus,
  Wand2,
  Star,
  CheckSquare,
  TestTube2,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarFooter,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { LanguageSelector } from "@/components/layout/LanguageSelector";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { DevUserSwitcher } from "@/components/layout/DevUserSwitcher";
import { useOrderNotificationsContext } from "@/contexts/OrderNotificationsContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { useCompany } from "@/contexts/CompanyContext";
import { cn } from "@/lib/utils";
import { useNavPreferences } from "@/hooks/useNavPreferences";
import { useAlertWebSocket } from "@/hooks/useAlertWebSocket";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { SortableNavWrapper } from "./SortableNavWrapper";
import { PinnedShortcuts } from "./PinnedShortcuts";
import { QuickCreate } from "./QuickCreate";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAfterFirstPaint } from "@/hooks/useAfterFirstPaint";

const IS_DEV = import.meta.env.DEV;

interface AppShellProps {
  children: ReactNode;
  noPadding?: boolean;
  /** Optional metadata for pages that need a title/breadcrumbs — rendered by the page itself, not AppShell */
  title?: string;
  breadcrumbs?: { label: string; href?: string }[];
}

interface FlatItem {
  type: "flat";
  titleKey: string;
  href: string;
  icon: LucideIcon;
  roles: string[];
  companyCodes?: string[];
  allowedCompanyIds?: number[];
  activePaths?: string[];
}

interface GroupItem {
  type: "group";
  titleKey: string;
  basePath: string;
  icon: LucideIcon;
  roles: string[];
  permissionKeys?: string[];
  children: { titleKey: string; href: string; icon: LucideIcon; roles?: string[]; companyCodes?: string[]; devOnly?: boolean }[];
  companyCodes?: string[];
  allowedCompanyIds?: number[];
}

type NavItem = FlatItem | GroupItem;

const ALL_ROLES = ["manager", "admin", "owner", "ecommerce", "trading", "logistics", "super_admin"];

const getKey = (item: NavItem): string =>
  item.type === "group" ? item.basePath : item.href;

function applySortOrder<T extends { href: string }>(items: T[], order: string[] | undefined): T[] {
  if (!order || order.length === 0) return items;
  return [...items].sort((a, b) => {
    const ia = order.indexOf(a.href);
    const ib = order.indexOf(b.href);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export function AppShell({ children, noPadding }: AppShellProps) {
  const [location, navigate] = useLocation();
  const { t } = useLanguage();
  const { activeCompany, isConsolidated } = useCompany();
  const secondaryReady = useAfterFirstPaint(500);
  const { data: dbUser } = useGetCurrentUser({
    query: {
      queryKey: getGetCurrentUserQueryKey(),
      staleTime: Infinity,
    },
  });
  const { dbUnreadTotal } = useOrderNotificationsContext();
  const { data: portalWorkload } = useQuery({
    queryKey: ["/api/portal/admin/service-operations", "pending-count"],
    queryFn: async () => {
      const response = await fetch("/api/portal/admin/service-operations?limit=1&offset=0", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Portal workload unavailable");
      return response.json() as Promise<{ summary?: Array<{ pending?: number }> }>;
    },
    enabled: ["admin", "owner", "manager", "staff"].includes(dbUser?.role ?? ""),
    retry: false,
    refetchInterval: 30_000,
  });
  const portalPendingCount = (portalWorkload?.summary ?? []).reduce(
    (sum, item) => sum + Number(item.pending ?? 0),
    0,
  );

  useAlertWebSocket({ enabled: secondaryReady });

  const getInitials = (name?: string) => {
    if (!name) return "U";
    return name.substring(0, 2).toUpperCase();
  };

  const navItems: NavItem[] = [
    // ── 1. DASHBOARD ──────────────────────────────────────────────────
    {
      type: "flat",
      titleKey: "Dashboard",
      href: "/dashboard",
      icon: LayoutDashboard,
      roles: ALL_ROLES,
      activePaths: ["/dashboard", "/approvals", "/ceo-dashboard", "/operational-dashboard", "/enterprise-dashboard", "/exceptions"],
    },

    // ── 2. EXECUTIVE ──────────────────────────────────────────────────
    {
      type: "flat",
      titleKey: "Executive",
      href: "/executive",
      icon: Trophy,
      roles: ["admin", "owner", "super_admin"],
      activePaths: ["/executive", "/holding"],
    },

    // ── 3. MASTER DATA ────────────────────────────────────────────────
    {
      type: "flat",
      titleKey: "Master Data",
      href: "/master-data",
      icon: Database,
      roles: ["manager", "admin", "owner", "super_admin"],
      activePaths: ["/master-data", "/products", "/katalog-terpadu"],
    },

    // ── 4. CRM & SALES ────────────────────────────────────────────────
    {
      type: "flat",
      titleKey: "CRM & Sales",
      href: "/sales",
      icon: TrendingUp,
      roles: ["admin", "owner", "super_admin"],
      activePaths: ["/sales", "/portal-product-orders", "/ecommerce"],
    },

    // ── 4b. QUICK QUOTE LEADS ─────────────────────────────────────────
    {
      type: "flat",
      titleKey: "Quick Quote Leads",
      href: "/portal/quick-quotes",
      icon: MessageSquarePlus,
      roles: ["admin", "owner", "super_admin"],
      activePaths: ["/portal/quick-quotes"],
    },

    // ── 4c. UNIFIED VENDOR INVITES ───────────────────────────────────────
    {
      type: "flat",
      titleKey: "Customer Portal Ops",
      href: "/admin/portal?tab=workload",
      icon: ClipboardList,
      roles: ["admin", "owner", "super_admin"],
      activePaths: ["/admin/portal"],
    },
    {
      type: "flat",
      titleKey: "Undang Vendor",
      href: "/admin/portal?tab=vendors",
      icon: Link2,
      roles: ["admin", "owner", "super_admin"],
      activePaths: ["/admin/portal"],
    },

    // ── 5. PROCUREMENT ────────────────────────────────────────────────
    {
      type: "flat",
      titleKey: "Procurement",
      href: "/purchase",
      icon: ClipboardList,
      roles: ["admin", "owner", "super_admin"],
      activePaths: ["/purchase", "/marketplace"],
    },

    // ── 5b. MARKETPLACE ───────────────────────────────────────────────
    {
      type: "group",
      titleKey: "Customer Portal Marketplace",
      basePath: "/marketplace",
      icon: ShoppingBag,
      roles: ALL_ROLES,
      permissionKeys: ["customer_portal.marketplace", "customer_portal.marketplace:view", "customer_portal.marketplace:manage"],
      children: [
        { titleKey: "RFQ", href: "/marketplace/rfqs", icon: List },
        { titleKey: "Purchase Orders", href: "/marketplace/purchase-orders", icon: Package },
        { titleKey: "Produk Unggulan", href: "/marketplace/produk-unggulan", icon: Star },
        { titleKey: "Kelengkapan Vendor", href: "/purchase/vendor-completion", icon: CheckSquare },
        { titleKey: "Master Price", href: "/marketplace/master-price", icon: Tags },
        ...(import.meta.env.PROD ? [] : [
          { titleKey: "QA Fixture Manager", href: "/marketplace/qa-fixture-manager", icon: TestTube2 as LucideIcon },
        ]),
      ],
    },

    // ── 6. LOGISTICS ──────────────────────────────────────────────────
    {
      type: "group",
      titleKey: "Logistics",
      basePath: "/logistics",
      icon: Truck,
      roles: ["admin", "owner", "super_admin", "logistics", "operations", "trading"],
      children: [
        { titleKey: "Hub", href: "/logistics", icon: LayoutGrid },
        { titleKey: "PPJK Kepabeanan", href: "/logistics/ppjk", icon: Globe },
        { titleKey: "Verifikasi Dokumen", href: "/logistics/doc-verify", icon: ShieldCheck },
        { titleKey: "Import Assistant", href: "/logistics/import-assistant", icon: Bot },
      ],
    },

    // ── 7. TENANT & PROPERTY ──────────────────────────────────────────
    {
      type: "flat",
      titleKey: "Tenant & Property",
      href: "/tenant",
      icon: Store,
      roles: ["admin", "owner", "super_admin", "manager"],
      allowedCompanyIds: [1, 4],
      activePaths: ["/tenant", "/sport-center"],
    },

    // ── 8. FINANCE ────────────────────────────────────────────────────
    {
      type: "group",
      titleKey: "Finance",
      basePath: "/finance",
      icon: BookOpen,
      roles: ["admin", "owner", "super_admin"],
      children: [
        { titleKey: "Finance Hub",         href: "/finance",                            icon: BookOpen },
        { titleKey: "Allocation Center",   href: "/finance/allocation",                 icon: ArrowLeftRight },
        { titleKey: "Bank Allocation",     href: "/finance/bank-allocation",            icon: Wand2 },
        { titleKey: "Advance Management",  href: "/finance/advances",                   icon: Wallet },
        { titleKey: "Kas & Bank",          href: "/accounting/kas-bank",                icon: Building2 },
        { titleKey: "Bank Disbursement",   href: "/accounting/bank-disbursements",      icon: ArrowUpRight },
        { titleKey: "Bank Receipt",        href: "/accounting/bank-receipts",           icon: ArrowDownLeft },
        { titleKey: "Tax Dashboard",       href: "/tax/dashboard",                      icon: Receipt },
        { titleKey: "Audit Pajak",         href: "/tax/audit",                          icon: ShieldCheck },
        { titleKey: "Setup Pajak",         href: "/accounting/taxes",                   icon: Receipt },
        { titleKey: "Ekspor DJP",          href: "/tax/export-djp",                     icon: FileText },
        { titleKey: "Bank Recon Config",     href: "/finance/recon-config",               icon: SlidersHorizontal },
        { titleKey: "Settlement Pattern",   href: "/finance/settlement-pattern",         icon: GitBranch },
      ],
    },

    // ── 9d. BIAYA OPERASIONAL ─────────────────────────────────────────
    {
      type: "group",
      titleKey: "Biaya Operasional",
      basePath: "/expense",
      icon: Receipt,
      roles: ["admin", "owner", "super_admin"],
      children: [
        { titleKey: "Daftar Biaya",        href: "/expense",                            icon: Receipt },
        { titleKey: "Dana Karyawan",       href: "/expense/dana-karyawan",              icon: Users },
        { titleKey: "Kasbon Karyawan",     href: "/expense/kasbon",                     icon: DollarSign },
        { titleKey: "Dana Talangan",       href: "/expense/talangan",                   icon: Wallet },
        { titleKey: "Aset Tetap",          href: "/expense/fixed-assets",               icon: Landmark },
        { titleKey: "Anggaran",            href: "/expense/budget",                     icon: BarChart2 },
        { titleKey: "Laporan Biaya",       href: "/expense/reports",                    icon: FileText },
        { titleKey: "Audit Disbursement",  href: "/expense/audit-disbursement",         icon: GitMerge },
        { titleKey: "Audit COA Talangan",  href: "/expense/audit-dana-talangan",        icon: ShieldAlert },
      ],
    },
    // ── 9b. CASH & BANK ──────────────────────────────────────────────
    {
      type: "group",
      titleKey: "Cash & Bank",
      basePath: "/cash-bank",
      icon: Building2,
      roles: ["admin", "owner", "super_admin"],
      children: [
        { titleKey: "Dashboard",       href: "/cash-bank/dashboard",      icon: LayoutDashboard },
        { titleKey: "Rekening",        href: "/cash-bank/accounts",       icon: CreditCard },
        { titleKey: "Mutasi",          href: "/cash-bank/mutations",       icon: ArrowLeftRight },
        { titleKey: "Import Statement",href: "/cash-bank/imports",        icon: Upload },
        { titleKey: "Transfer",        href: "/cash-bank/transfers",       icon: ArrowUpRight },
        { titleKey: "Rekonsiliasi",    href: "/accounting/bank-reconciliation",  icon: ClipboardCheck },
        { titleKey: "Forecast",        href: "/cash-bank/forecast",        icon: TrendingUp },
        { titleKey: "Petty Cash",      href: "/cash-bank/petty-cash",      icon: Wallet },
        { titleKey: "Pengaturan",      href: "/cash-bank/settings",        icon: Settings },
      ],
    },
    // ── 9c. ACCOUNTING HUB ────────────────────────────────────────────
    {
      type: "flat",
      titleKey: "Accounting Hub",
      href: "/accounting/hub",
      icon: BookOpen,
      roles: ["admin", "owner", "super_admin"],
      activePaths: ["/accounting/hub"],
    },

    // ── 9c. WA REPORT SETTINGS ────────────────────────────────────────
    {
      type: "flat",
      titleKey: "Laporan WA Harian",
      href: "/accounting/wa-report-settings",
      icon: MessageCircle,
      roles: ["admin", "owner", "super_admin"],
      activePaths: ["/accounting/wa-report-settings"],
    },

    // ── 10. AI CENTER ─────────────────────────────────────────────────
    {
      type: "flat",
      titleKey: "AI Center",
      href: "/ai-center",
      icon: Bot,
      roles: ["admin", "owner", "super_admin"],
      activePaths: ["/ai-center", "/ai-approvals", "/operational-context", "/intelligence-alerts"],
    },

    // ── 10b. AI REVIEW ────────────────────────────────────────────────
    {
      type: "flat",
      titleKey: "AI Review",
      href: "/ai/review",
      icon: Brain,
      roles: ["admin", "owner", "super_admin", "finance", "accounting", "treasury", "tax"],
      activePaths: ["/ai/review"],
    },

    // ── 11. REPORTS ───────────────────────────────────────────────────
    {
      type: "flat",
      titleKey: "Reports",
      href: "/reports",
      icon: BarChart2,
      roles: ["manager", "admin", "owner", "super_admin"],
      activePaths: ["/reports", "/audit", "/vendors", "/analytics"],
    },

    // ── 12. PROFIL PERUSAHAAN ─────────────────────────────────────────
    {
      type: "flat",
      titleKey: "Profil Perusahaan",
      href: "/settings/company-profile",
      icon: Building2,
      roles: ["admin", "owner", "super_admin"],
      activePaths: ["/settings/company-profile"],
    },

    // ── 13. ADMINISTRATION ────────────────────────────────────────────
    {
      type: "flat",
      titleKey: "Administration",
      href: "/settings",
      icon: Shield,
      roles: ["admin", "owner", "super_admin"],
      activePaths: ["/settings", "/users", "/org", "/correspondences", "/email-inbox", "/media", "/system-health", "/system/observability", "/notifications", "/notification-history", "/portal"],
    },
  ];

  const getNavTitle = (key: string): string => {
    return (t.nav as Record<string, string>)[key] ?? key;
  };

  const { data: aiDrafts = [] } = useListAiDraftQuotations({
    query: {
      enabled: secondaryReady && ((dbUser?.role as string) === "admin" || (dbUser?.role as string) === "owner"),
      refetchInterval: 60_000,
      queryKey: getListAiDraftQuotationsQueryKey(),
    },
  });
  const aiDraftCount = aiDrafts.length;

  const { data: tenantDashboardNav } = useQuery<{ invoices?: { overdue?: number } }>({
    queryKey: ["tenant-dashboard-nav-badge"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/dashboard", { credentials: "include" });
      if (!r.ok) return {};
      return r.json();
    },
    refetchInterval: 60_000,
    enabled: secondaryReady && ((dbUser?.role as string) === "admin" || (dbUser?.role as string) === "owner"),
  });
  const tenantOverdueCount = tenantDashboardNav?.invoices?.overdue ?? 0;

  const customRolePermissions = (dbUser as any)?.customRolePermissions as string[] | null | undefined;
  const hasNavPermission = (keys?: string[]): boolean => {
    if (!keys || keys.length === 0) return true;
    if ((dbUser?.role as string | undefined) === "super_admin") return true;
    if (!customRolePermissions) return false;
    return keys.some((key) => customRolePermissions.includes(key));
  };

  const { hiddenItems, itemOrder, childOrder, toggle: toggleHidden, reorder, reorderChildren, reset: resetHidden } = useNavPreferences();
  const [customizeMode, setCustomizeMode] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try { return localStorage.getItem("bizportal_sidebar_open") !== "false"; }
    catch { return true; }
  });
  const handleSidebarOpenChange = (open: boolean) => {
    setSidebarOpen(open);
    try { localStorage.setItem("bizportal_sidebar_open", String(open)); } catch { /* ignore */ }
  };

  const SIDEBAR_MIN = 200;
  const SIDEBAR_MAX = 420;
  const SIDEBAR_DEFAULT = 256;
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem("bizportal_sidebar_width");
    const n = saved ? parseInt(saved, 10) : NaN;
    return isNaN(n) ? SIDEBAR_DEFAULT : Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, n));
  });
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const onDragMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = ev.clientX - dragStartX.current;
      const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, dragStartWidth.current + delta));
      setSidebarWidth(next);
    };
    const onMouseUp = (ev: MouseEvent) => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const delta = ev.clientX - dragStartX.current;
      const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, dragStartWidth.current + delta));
      localStorage.setItem("bizportal_sidebar_width", String(next));
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [sidebarWidth]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Helper: apakah custom-role user punya akses ke path ini?
  const canAccessPath = (p: string): boolean => {
    if (!customRolePermissions) return true; // bukan custom-role, lolos
    if (
      (p.startsWith("/marketplace") || p === "/purchase/vendor-completion") &&
      hasNavPermission([
        "customer_portal.marketplace",
        "customer_portal.marketplace:view",
        "customer_portal.marketplace:manage",
      ])
    ) {
      return true;
    }
    const seg = p.replace(/^\//, "").split("/")[0] ?? "";
    const full = p.replace(/^\//, "");
    return (
      customRolePermissions.includes(`${seg}:view`) ||
      customRolePermissions.includes(`${full}:view`) ||
      customRolePermissions.includes(seg) ||
      customRolePermissions.includes(full)
    );
  };

  const filteredNav = navItems.filter((item) => {
    if (!dbUser?.role) return false;
    if (!hasNavPermission(item.type === "group" ? item.permissionKeys : undefined)) return false;

    // Filter berdasarkan company code
    if (item.companyCodes && item.companyCodes.length > 0) {
      if (isConsolidated || !activeCompany) return false;
      if (!item.companyCodes.includes(activeCompany.companyCode)) return false;
    }

    // Filter berdasarkan allowed company IDs (Tenant & Property restriction)
    if (item.allowedCompanyIds && item.allowedCompanyIds.length > 0) {
      if (isConsolidated || !activeCompany) return false;
      if (!item.allowedCompanyIds.includes(activeCompany.id)) return false;
    }

    // owner dan admin (built-in) melihat semua
    if ((dbUser.role as string) === "owner") return true;
    if ((dbUser.role as string) === "admin") return true;

    // Custom role permissions: tampilkan grup jika minimal satu child lolos
    // semua filter (custom-permission + role + company + devOnly).
    if (customRolePermissions != null) {
      if (item.type === "flat") return canAccessPath(item.href);
      // Grup: tampil jika ada child yang lolos semua filter
      return item.children.some(
        (c) =>
          canAccessPath(c.href) &&
          (!c.roles || c.roles.includes(dbUser.role)) &&
          filterChild(c) &&
          (IS_DEV || !c.devOnly),
      );
    }

    // Built-in roles
    return item.roles.includes(dbUser.role);
  });

  // Per-user hidden items filter (bypass in customize mode to show all)
  const visibleNav = customizeMode
    ? filteredNav
    : filteredNav.filter((item) => !hiddenItems.includes(getKey(item)));

  // Terapkan urutan custom pengguna
  const orderedNav = itemOrder.length === 0
    ? visibleNav
    : [...visibleNav].sort((a, b) => {
        const ia = itemOrder.indexOf(getKey(a));
        const ib = itemOrder.indexOf(getKey(b));
        if (ia === -1 && ib === -1) return 0;
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });

  const handleNavDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const keys = orderedNav.map(getKey);
    const oldIdx = keys.indexOf(String(active.id));
    const newIdx = keys.indexOf(String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    reorder(arrayMove(keys, oldIdx, newIdx));
  };

  const handleChildDragEnd = (basePath: string, orderedHrefs: string[]) => ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIdx = orderedHrefs.indexOf(String(active.id));
    const newIdx = orderedHrefs.indexOf(String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    reorderChildren(basePath, arrayMove(orderedHrefs, oldIdx, newIdx));
  };

  const isGroupActive = (g: GroupItem) => {
    if (location === g.basePath || location.startsWith(`${g.basePath}/`)) return true;
    // Cek apakah salah satu child aktif (untuk grup dengan basePath virtual)
    if (g.children.some((c) => location === c.href || location.startsWith(`${c.href}/`))) return true;
    return false;
  };

  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();
  usePageTracker();

  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts((s) => !s);
        return;
      }
      if (e.key === "Escape") {
        setShowShortcuts(false);
        return;
      }
      if (showShortcuts && /^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const item = orderedNav[idx];
        if (item) {
          e.preventDefault();
          const href = item.type === "group" ? (item.children[0]?.href ?? item.basePath) : item.href;
          navigate(href);
          setShowShortcuts(false);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showShortcuts, orderedNav, navigate]);

  const { data: navConfig } = useQuery<Record<string, string[]>>({
    queryKey: ["settings", "nav-company-config"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/settings/nav-company-config", { credentials: "include" });
        if (!res.ok) return {};
        return res.json();
      } catch { return {}; }
    },
    staleTime: 5 * 60 * 1000,
    enabled: secondaryReady && ((dbUser?.role as string) === "admin" || (dbUser?.role as string) === "owner"),
  });

  const companyKey = isConsolidated ? "__all__" : String(activeCompany?.id ?? 0);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const item of navItems) {
      if (item.type === "group") {
        const active =
          location === item.basePath ||
          location.startsWith(`${item.basePath}/`) ||
          item.children.some((c) => location === c.href || location.startsWith(`${c.href}/`));
        if (active) initial[`${companyKey}:${item.basePath}`] = true;
      }
    }
    return initial;
  });

  const toggleGroup = (basePath: string) =>
    setOpenGroups((s) => ({ ...s, [`${companyKey}:${basePath}`]: !s[`${companyKey}:${basePath}`] }));

  const filterChild = (c: { href: string; companyCodes?: string[] }) => {
    const effectiveCodes = c.href in (navConfig ?? {}) ? (navConfig ?? {})[c.href] : c.companyCodes;
    if (!effectiveCodes || effectiveCodes.length === 0) return true;
    if (effectiveCodes.includes("__holding__")) return isConsolidated;
    if (isConsolidated) return false;
    return activeCompany ? effectiveCodes.includes(activeCompany.companyCode) : false;
  };

  const isChildActive = (href: string) => {
    if (location === href) return true;
    if (href === "/sales" || href === "/purchase" || href === "/logistics") return false;
    return location.startsWith(`${href}/`) || location === href;
  };

  const renderNavList = (items: NavItem[], onDragEnd: (e: DragEndEvent) => void) => {
    if (!customizeMode) {
      return (
        <SidebarMenu>
          {items.map(renderNavItem)}
        </SidebarMenu>
      );
    }
    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map(getKey)} strategy={verticalListSortingStrategy}>
          <div className="flex w-full min-w-0 flex-col gap-1">
            {items.map((item) => (
              <SortableNavWrapper key={getKey(item)} id={getKey(item)}>
                {renderNavItem(item)}
              </SortableNavWrapper>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    );
  };

  const renderNavItem = (item: NavItem) => {
    const itemKey = item.type === "group" ? item.basePath : item.href;
    const isHidden = hiddenItems.includes(itemKey);

    if (item.type === "flat") {
      const isNotif = item.href === "/notifications";
      const isPortalOps = item.href === "/admin/portal?tab=workload";
      const isActive =
        location === item.href ||
        location.startsWith(`${item.href}/`) ||
        (item.activePaths ?? []).some(
          (p) => location === p || location.startsWith(`${p}/`)
        );
      return (
        <SidebarMenuItem key={item.href} className={cn(customizeMode && isHidden && "opacity-40")}>
          <div className="flex items-center">
            <SidebarMenuButton
              asChild
              isActive={isActive}
              tooltip={getNavTitle(item.titleKey)}
              className="flex-1"
            >
              <Link href={item.href} className="flex items-center gap-3" data-testid={`nav-${item.titleKey.toLowerCase().replace(/\s+/g, "-")}`}>
                <item.icon size={18} />
                <span className="flex-1">{getNavTitle(item.titleKey)}</span>
                {isNotif && dbUnreadTotal > 0 && (
                  <span className="ml-auto inline-flex items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none min-w-[18px]">
                    {dbUnreadTotal > 99 ? "99+" : dbUnreadTotal}
                  </span>
                )}
                {isPortalOps && portalPendingCount > 0 && (
                  <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                    {portalPendingCount > 99 ? "99+" : portalPendingCount}
                  </span>
                )}
              </Link>
            </SidebarMenuButton>
            {customizeMode && (
              <button
                onClick={() => toggleHidden(itemKey)}
                className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground"
                title={isHidden ? "Tampilkan" : "Sembunyikan"}
              >
                {isHidden ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
            )}
          </div>
        </SidebarMenuItem>
      );
    }

    const open = openGroups[`${companyKey}:${item.basePath}`] ?? false;
    const active = isGroupActive(item);

    const roleFilteredChildren = item.children.filter((c) =>
      canAccessPath(c.href) &&
      (!c.roles || (dbUser?.role && c.roles.includes(dbUser.role))) &&
      filterChild(c) &&
      (IS_DEV || !c.devOnly)
    );
    const visibleChildren = customizeMode
      ? roleFilteredChildren
      : roleFilteredChildren.filter((c) => !hiddenItems.includes(c.href));
    const sortedChildren = applySortOrder(visibleChildren, childOrder[item.basePath]);

    const renderChildItem = (c: typeof sortedChildren[0]) => {
      const childHidden = hiddenItems.includes(c.href);
      return (
        <SidebarMenuSubItem key={c.href} className={cn(customizeMode && childHidden && "opacity-40")}>
          <div className="flex items-center">
            <SidebarMenuSubButton asChild isActive={isChildActive(c.href)} className="flex-1">
              <Link href={c.href} className="flex items-center gap-2" data-testid={`nav-sub-${c.titleKey.toLowerCase().replace(/\s+/g, "-")}`}>
                <c.icon size={14} />
                <span className="flex-1">{getNavTitle(c.titleKey)}</span>
                {c.href === "/sales/ai-drafts" && aiDraftCount > 0 && (
                  <span className="ml-auto inline-flex items-center justify-center rounded-full bg-purple-600 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none min-w-[18px]">
                    {aiDraftCount}
                  </span>
                )}
                {c.href === "/tenant/invoices" && tenantOverdueCount > 0 && (
                  <span className="ml-auto inline-flex items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none min-w-[18px]">
                    {tenantOverdueCount > 99 ? "99+" : tenantOverdueCount}
                  </span>
                )}
              </Link>
            </SidebarMenuSubButton>
            {customizeMode && (
              <button
                onClick={() => toggleHidden(c.href)}
                className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground"
                title={childHidden ? "Tampilkan" : "Sembunyikan"}
              >
                {childHidden ? <Eye size={11} /> : <EyeOff size={11} />}
              </button>
            )}
          </div>
        </SidebarMenuSubItem>
      );
    };

    return (
      <SidebarMenuItem key={item.basePath} className={cn(customizeMode && isHidden && "opacity-40")}>
        <div className="flex items-center">
          <SidebarMenuButton
            isActive={active}
            tooltip={getNavTitle(item.titleKey)}
            onClick={() => toggleGroup(item.basePath)}
            data-testid={`nav-group-${item.titleKey.toLowerCase().replace(/\s+/g, "-")}`}
            className="flex items-center gap-3 flex-1"
          >
            <item.icon size={18} />
            <span className="flex-1">{getNavTitle(item.titleKey)}</span>
            {item.basePath === "/tenant" && tenantOverdueCount > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none min-w-[18px]">
                {tenantOverdueCount > 99 ? "99+" : tenantOverdueCount}
              </span>
            )}
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </SidebarMenuButton>
          {customizeMode && (
            <button
              onClick={() => toggleHidden(itemKey)}
              className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground"
              title={isHidden ? "Tampilkan" : "Sembunyikan"}
            >
              {isHidden ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          )}
        </div>
        {open && (
          <SidebarMenuSub>
            {customizeMode ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleChildDragEnd(item.basePath, sortedChildren.map((c) => c.href))}
              >
                <SortableContext items={sortedChildren.map((c) => c.href)} strategy={verticalListSortingStrategy}>
                  {sortedChildren.map((c) => (
                    <SortableNavWrapper key={c.href} id={c.href}>
                      {renderChildItem(c)}
                    </SortableNavWrapper>
                  ))}
                </SortableContext>
              </DndContext>
            ) : (
              sortedChildren.map(renderChildItem)
            )}
          </SidebarMenuSub>
        )}
      </SidebarMenuItem>
    );
  };

  const shortcutsOverlay = showShortcuts ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => setShowShortcuts(false)}
    >
      <div
        className="relative w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-background shadow-2xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold">Keyboard Shortcuts</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Tekan <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">1</kbd>–<kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">9</kbd> untuk navigasi cepat · <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">?</kbd> tutup · <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">Esc</kbd> tutup
            </p>
          </div>
          <button
            onClick={() => setShowShortcuts(false)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
          {orderedNav.map((item, idx) => {
            const shortcutKey = idx < 9 ? String(idx + 1) : null;
            const title = getNavTitle(item.titleKey);
            const Icon = item.icon;
            const children = item.type === "group"
              ? item.children
                  .filter((c) => filterChild(c) && (IS_DEV || !("devOnly" in c && c.devOnly)))
                  .slice(0, 6)
              : [];
            return (
              <div key={item.type === "group" ? item.basePath : item.href} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  {shortcutKey && (
                    <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">{shortcutKey}</kbd>
                  )}
                  <Icon size={14} className="shrink-0 text-primary" />
                  <span className="text-xs font-semibold truncate">{title}</span>
                </div>
                {children.length > 0 && (
                  <div className="pl-1 space-y-0.5">
                    {children.map((c) => (
                      <button
                        key={c.href}
                        onClick={() => { navigate(c.href); setShowShortcuts(false); }}
                        className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      >
                        <c.icon size={11} className="shrink-0" />
                        <span className="truncate">{getNavTitle(c.titleKey)}</span>
                      </button>
                    ))}
                    {item.type === "group" && item.children.filter((c) => filterChild(c) && (IS_DEV || !("devOnly" in c && c.devOnly))).length > 6 && (
                      <span className="block pl-1 text-[10px] text-muted-foreground/60">
                        +{item.children.filter((c) => filterChild(c) && (IS_DEV || !("devOnly" in c && c.devOnly))).length - 6} lainnya…
                      </span>
                    )}
                  </div>
                )}
                {item.type === "flat" && (
                  <button
                    onClick={() => { navigate(item.href); setShowShortcuts(false); }}
                    className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <span className="truncate">→ {item.href}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground flex gap-4">
          <span><kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">Ctrl+K</kbd> Command palette</span>
          <span><kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">?</kbd> Toggle overlay ini</span>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={handleSidebarOpenChange} style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}>
      {shortcutsOverlay}
      <div className="flex min-h-[100dvh] w-full bg-background text-foreground">
        <Sidebar className="border-r border-border">
          <div
            onMouseDown={onDragMouseDown}
            className="absolute top-0 right-0 z-50 h-full w-1.5 cursor-col-resize group hidden md:flex items-center justify-center"
            title="Geser untuk resize sidebar"
          >
            <div className="h-12 w-0.5 rounded-full bg-border group-hover:bg-primary transition-colors" />
          </div>
          <SidebarHeader className="border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0">
                <Building2 size={18} />
              </div>
              <span className="text-lg font-bold tracking-tight flex-1">BizPortal</span>
            </div>
            {(["admin", "owner", "super_admin", "manager"] as string[]).includes(dbUser?.role as string) && (
              <button
                onClick={() => setCustomizeMode((m) => !m)}
                className={cn(
                  "mt-1.5 w-full flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  customizeMode
                    ? "bg-primary text-primary-foreground border-primary"
                    : "text-foreground hover:bg-accent hover:border-accent-foreground/20"
                )}
                title="Sesuaikan tampilan menu"
              >
                <SlidersHorizontal size={13} />
                <span>{customizeMode ? "✓ Mode Kustomisasi Aktif" : "Kustomisasi Sidebar"}</span>
              </button>
            )}
            {customizeMode && (
              <div className="mt-1 flex items-center justify-between gap-2 rounded-md bg-amber-950/40 border border-amber-700/30 px-2 py-1.5 text-[11px] text-amber-300">
                <span>Seret <span className="font-mono">⠿</span> untuk reorder · <EyeOff size={10} className="inline -mt-px" /> sembunyikan</span>
                <button
                  onClick={resetHidden}
                  className="shrink-0 font-semibold text-red-400 hover:text-red-300"
                >
                  Reset
                </button>
              </div>
            )}
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                {renderNavList(orderedNav, handleNavDragEnd)}
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter />
        </Sidebar>

        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
          <div className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-border bg-background px-4 sm:px-6 lg:hidden">
            <SidebarTrigger />
            <div className="flex items-center gap-2 font-bold">
              <Building2 size={18} className="text-primary" />
              <span>BizPortal</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setCmdOpen(true)}
                className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors"
                aria-label="Buka pencarian (Ctrl+K)"
              >
                <Search size={13} />
                <span className="hidden sm:inline">Cari...</span>
                <kbd className="hidden sm:inline rounded bg-background px-1 py-0.5 text-[10px] font-mono border border-border">⌘K</kbd>
              </button>
              {IS_DEV && dbUser && (
                <span className="hidden sm:flex items-center gap-1 rounded border border-amber-600/40 bg-amber-950/30 px-2 py-0.5 text-[10px] font-mono text-amber-400 max-w-[140px] truncate" title={`Login sebagai: ${dbUser.email}`}>
                  {dbUser.name || dbUser.email}
                </span>
              )}
              {IS_DEV && <ErrorBoundary fallback={null}><DevUserSwitcher /></ErrorBoundary>}
              <button
                onClick={() => setShowShortcuts(true)}
                className="hidden sm:flex items-center justify-center rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors"
                title="Keyboard shortcuts (?)"
              >
                <span className="font-mono font-bold">?</span>
              </button>
              <QuickCreate compact />
              <NotificationBell />
            </div>
          </div>
          <div className="hidden lg:sticky lg:top-0 lg:z-10 lg:flex lg:flex-col">
          <div className="flex h-12 items-center justify-between border-b border-border bg-background px-6">
            <CompanySwitcher />
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCmdOpen(true)}
                className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
                aria-label="Buka pencarian (Ctrl+K)"
              >
                <Search size={13} />
                <span>Cari halaman...</span>
                <kbd className="ml-1 rounded bg-background px-1 py-0.5 text-[10px] font-mono border border-border">Ctrl+K</kbd>
              </button>
              <QuickCreate />
              {IS_DEV && dbUser && (
                <span className="flex items-center gap-1.5 rounded border border-amber-600/40 bg-amber-950/30 px-2 py-1 text-[11px] font-mono text-amber-400 max-w-[200px]" title={dbUser.email ?? ""}>
                  <span className="text-amber-600/70 shrink-0">as:</span>
                  <span className="truncate">{dbUser.name || dbUser.email}</span>
                </span>
              )}
              {IS_DEV && <ErrorBoundary fallback={null}><DevUserSwitcher /></ErrorBoundary>}
              <button
                onClick={() => setShowShortcuts(true)}
                className="flex items-center justify-center rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
                title="Keyboard shortcuts (?)"
              >
                <span className="font-mono font-bold text-[11px]">?</span>
              </button>
              <LanguageSelector />
              <NotificationBell />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Avatar className="h-7 w-7 border border-border">
                      <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                        {getInitials(dbUser?.name || undefined)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col text-left">
                      <span className="text-xs font-medium leading-none">{dbUser?.name || "User"}</span>
                      <span className="text-[10px] text-muted-foreground capitalize">{dbUser?.role || t.common.noRole}</span>
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-popover text-popover-foreground border-border">
                  <div className="flex items-center gap-2 p-2">
                    <Avatar className="h-8 w-8 border border-border">
                      <AvatarFallback>{getInitials(dbUser?.name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{dbUser?.name}</p>
                      <p className="text-xs text-muted-foreground">{dbUser?.email}</p>
                    </div>
                  </div>
                  <div className="p-2 pt-0">
                    <Badge variant="secondary" className="w-full justify-center capitalize">
                      {dbUser?.role} {t.common.division}
                    </Badge>
                  </div>
                  <DropdownMenuItem
                    onClick={() => { window.location.href = "/api/logout?redirect=/bizportal/"; }}
                    className="cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>{t.common.logOut}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <PinnedShortcuts />
          </div>
          <div className={noPadding ? "flex-1 overflow-hidden flex flex-col" : "flex-1 overflow-auto p-4 sm:p-6 lg:p-8"}>
            {(location.startsWith("/tenant") || location.startsWith("/sport-center")) && !isConsolidated && activeCompany && ![1, 4].includes(activeCompany.id) ? (
              <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 p-8">
                <div className="rounded-full bg-red-100 dark:bg-red-950 p-5 border border-red-200 dark:border-red-800">
                  <Lock className="h-10 w-10 text-red-500" />
                </div>
                <div className="text-center space-y-2">
                  <h2 className="text-xl font-bold text-foreground">Akses Ditolak</h2>
                  <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
                    Modul <strong>Tenant & Property</strong> hanya tersedia untuk:
                  </p>
                  <div className="flex flex-col items-center gap-2 mt-3">
                    <span className="inline-flex items-center gap-2 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-sm font-semibold px-5 py-2">
                      PT Cahaya Sejati Teknologi
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 text-sm font-semibold px-5 py-2">
                      PT Elmira Ratu Abadi
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-4">
                    Pilih salah satu perusahaan di atas melalui menu pemilih perusahaan di header.
                  </p>
                </div>
              </div>
            ) : (
              children
            )}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
