import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import {
  Shield, Users, MessageSquare, Globe, Settings, ExternalLink,
  UserCircle, ShieldCheck, ClipboardCheck, Network,
  Mail, MessageCircle, Activity, Bell, History,
  Globe2, UserCheck, LogIn, ImageIcon, Link2, LayoutGrid,
  Cog, Bot, ScanLine, KeyRound, Heart, Eye, Database,
  ShieldAlert, ArrowLeftRight, FileSearch,
} from "lucide-react";

interface Tab { label: string; href: string; icon: React.ComponentType<{ className?: string }> }
interface Section { key: string; title: string; icon: React.ComponentType<{ className?: string }>; items: Tab[]; superAdminOnly?: boolean }

const ALL_SECTIONS: Section[] = [
  {
    key: "users-roles",
    title: "Users & Roles",
    icon: Users,
    items: [
      { label: "Users", href: "/users", icon: UserCircle },
      { label: "Role Management", href: "/settings/roles", icon: ShieldCheck },
      { label: "Approval Rules", href: "/settings/approval-rules", icon: ClipboardCheck },
      { label: "Organization Structure", href: "/org", icon: Network },
    ],
  },
  {
    key: "communications",
    title: "Communications",
    icon: MessageSquare,
    items: [
      { label: "Correspondences", href: "/correspondences", icon: Mail },
      { label: "Email Inbox", href: "/email-inbox", icon: MessageCircle },
      { label: "WA Templates", href: "/settings/wa-templates", icon: MessageSquare },
      { label: "Enterprise WA Templates", href: "/settings/enterprise-wa-templates", icon: MessageSquare },
      { label: "WA Notification Logs", href: "/settings/wa-notification-logs", icon: Activity },
      { label: "Notification History", href: "/notification-history", icon: History },
      { label: "Notifications Inbox", href: "/notifications", icon: Bell },

    ],
  },
  {
    key: "portal-management",
    title: "Portal Management",
    icon: Globe,
    items: [
      { label: "Portal Customers", href: "/portal/customers", icon: Globe2 },
      { label: "Customer Verification", href: "/portal/customer-verification", icon: UserCheck },
      { label: "Onboarding Approvals", href: "/portal/onboarding-approvals", icon: LogIn },
      { label: "Media Manager", href: "/media", icon: ImageIcon },
      { label: "Short Links", href: "/settings/short-links", icon: Link2 },
      { label: "Document Templates", href: "/settings/document-templates", icon: LayoutGrid },
    ],
  },
  {
    key: "system-settings",
    title: "System Settings",
    icon: Settings,
    items: [
      { label: "App Settings", href: "/settings/app", icon: Cog },
      { label: "Navigation Config", href: "/settings/nav-company-config", icon: LayoutGrid },
      { label: "AI Chatbot Settings", href: "/settings/ai-chatbot", icon: Bot },
      { label: "AI Knowledge Base", href: "/settings/ai-chatbot/knowledge", icon: Bot },
      { label: "AI Scan Settings", href: "/settings/ai-scan", icon: ScanLine },
    ],
  },
  {
    key: "audit-center",
    title: "Audit Center",
    icon: ShieldAlert,
    items: [
      { label: "Security Center", href: "/settings/security-center", icon: ShieldAlert },
      { label: "Cross Company Access", href: "/administration/cross-company-access", icon: ArrowLeftRight },
      { label: "Security Audit Log", href: "/reports/audit-log", icon: FileSearch },
    ],
  },
  {
    key: "super-admin",
    title: "Super Admin",
    icon: Shield,
    superAdminOnly: true,
    items: [
      { label: "Secrets & Env Vars", href: "/settings/secrets", icon: KeyRound },
      { label: "System Health", href: "/system-health", icon: Heart },
      { label: "Error Observability", href: "/system/observability/errors", icon: Eye },
      { label: "DB Sync", href: "/admin/db-sync", icon: Database },
    ],
  },
];

const COLORS: Record<string, { text: string; bg: string; border: string }> = {
  "users-roles":       { text: "text-blue-600",   bg: "bg-blue-50 dark:bg-blue-950/30",    border: "border-blue-200 dark:border-blue-800" },
  "communications":    { text: "text-green-600",  bg: "bg-green-50 dark:bg-green-950/30",   border: "border-green-200 dark:border-green-800" },
  "portal-management": { text: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-950/30", border: "border-purple-200 dark:border-purple-800" },
  "system-settings":   { text: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950/30", border: "border-orange-200 dark:border-orange-800" },
  "audit-center":      { text: "text-red-600",    bg: "bg-red-50 dark:bg-red-950/30",       border: "border-red-200 dark:border-red-800" },
  "super-admin":       { text: "text-red-600",    bg: "bg-red-50 dark:bg-red-950/30",       border: "border-red-200 dark:border-red-800" },
};

export default function AdministrationWorkspacePage({ section }: { section?: string }) {
  const { data: dbUser } = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), staleTime: Infinity },
  });
  const isSuperAdmin = (dbUser?.role as string) === "super_admin";

  const visibleSections = ALL_SECTIONS.filter((s) => !s.superAdminOnly || isSuperAdmin);

  const activeKey = section ?? "users-roles";
  const activeSection = visibleSections.find((s) => s.key === activeKey) ?? visibleSections[0];
  const colors = COLORS[activeSection?.key ?? "users-roles"] ?? COLORS["users-roles"];
  const SectionIcon = activeSection?.icon ?? Users;

  if (!activeSection) return null;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <PageHeader
          breadcrumb={[
            { label: "Dashboard", href: "/" },
            { label: "Administration", href: "/settings" },
            { label: activeSection.title },
          ]}
          title={activeSection.title}
          description="Administration · Workspace"
        />

        <div className="flex gap-1 flex-wrap border-b pb-0">
          {visibleSections.map((s) => {
            const isActive = s.key === activeSection.key;
            const Icon = s.icon;
            const isSA = s.superAdminOnly;
            return (
              <Link key={s.key} href={`/settings/workspace/${s.key}`}>
                <button
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors ${
                    isActive
                      ? isSA ? "border-red-500 text-red-600" : "border-primary text-primary"
                      : isSA
                        ? "border-transparent text-red-400 hover:text-red-600 hover:border-red-300"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {s.title}
                </button>
              </Link>
            );
          })}
        </div>

        {activeSection.items.length === 0 ? (
          <EmptyState
            title="Tidak ada menu"
            description="Belum ada item pada section ini."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeSection.items.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={`group flex items-center gap-3 rounded-lg border p-4 cursor-pointer transition-all hover:shadow-sm hover:-translate-y-0.5 ${colors.border} ${colors.bg}`}
                  >
                    <div className="rounded-md p-2 bg-white dark:bg-black/20 shadow-sm shrink-0">
                      <Icon className={`h-4 w-4 ${colors.text}`} />
                    </div>
                    <span className="text-sm font-medium group-hover:underline flex-1">{item.label}</span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
