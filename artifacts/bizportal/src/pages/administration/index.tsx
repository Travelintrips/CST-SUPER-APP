import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { Shield, Users, MessageSquare, Globe, Settings } from "lucide-react";

const SECTIONS = [
  {
    key: "users-roles",
    title: "Users & Roles",
    description: "Pengguna, manajemen role, aturan approval, dan struktur organisasi.",
    icon: Users,
    color: "text-blue-600",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200 dark:border-blue-800",
  },
  {
    key: "communications",
    title: "Communications",
    description: "Korespondensi, email inbox, WhatsApp templates, dan notifikasi.",
    icon: MessageSquare,
    color: "text-green-600",
    bg: "bg-green-50 dark:bg-green-950/30",
    border: "border-green-200 dark:border-green-800",
  },
  {
    key: "portal-management",
    title: "Portal Management",
    description: "Pelanggan portal, verifikasi, onboarding, media manager, dan short links.",
    icon: Globe,
    color: "text-purple-600",
    bg: "bg-purple-50 dark:bg-purple-950/30",
    border: "border-purple-200 dark:border-purple-800",
  },
  {
    key: "system-settings",
    title: "System Settings",
    description: "App settings, navigasi, AI chatbot, AI scan, dan konfigurasi sistem.",
    icon: Settings,
    color: "text-orange-600",
    bg: "bg-orange-50 dark:bg-orange-950/30",
    border: "border-orange-200 dark:border-orange-800",
  },
];

export default function AdministrationHubPage() {
  const { data: dbUser } = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), staleTime: Infinity },
  });
  const isSuperAdmin = (dbUser?.role as string) === "super_admin";

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Administration"
          description="Pengguna, komunikasi, portal pelanggan, dan pengaturan sistem."
          breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "Administration" }]}
          favoriteEnabled
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <Link key={s.key} href={`/settings/workspace/${s.key}`}>
                <div
                  className={`group cursor-pointer rounded-xl border p-6 transition-all hover:shadow-md hover:-translate-y-0.5 ${s.bg} ${s.border}`}
                >
                  <div className="flex items-start gap-4">
                    <div className="rounded-lg p-2.5 bg-white dark:bg-black/20 shadow-sm">
                      <Icon className={`h-6 w-6 ${s.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="font-semibold text-base leading-tight group-hover:underline">
                        {s.title}
                      </h2>
                      <p className="text-sm text-muted-foreground mt-1 leading-snug">
                        {s.description}
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {isSuperAdmin && (
          <div className="pt-2 border-t">
            <Link href="/settings/workspace/super-admin" className="text-sm text-red-600 hover:underline font-medium">
              → Super Admin Tools (secrets, system health, observability, DB sync)
            </Link>
          </div>
        )}
      </div>
    </AppShell>
  );
}
