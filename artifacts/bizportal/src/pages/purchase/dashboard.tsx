import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useGetPurchaseSummary,
  useListPurchaseDocuments,
} from "@workspace/api-client-react";
import { ClipboardList, ShoppingBag, FileText, TrendingDown, Plus } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCompany } from "@/contexts/CompanyContext";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export default function PurchaseDashboardPage() {
  const { t } = useLanguage();
  const { activeCompanyId } = useCompany();
  const { data: summary } = useGetPurchaseSummary({ company: activeCompanyId } as any);
  const { data: recentDocs } = useListPurchaseDocuments({ company: activeCompanyId } as any);
  const recent = (recentDocs ?? []).slice(0, 8);

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={t.purchase.title}
          description={t.purchase.subtitle}
          breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "Purchase" }]}
          favoriteEnabled
          actions={
            <div className="flex gap-2">
              <Link href="/purchase/rfq">
                <Button variant="outline" data-testid="link-go-rfq">
                  <ClipboardList className="mr-2 h-4 w-4" /> {t.purchase.rfq}
                </Button>
              </Link>
              <Link href="/purchase/rfq/new">
                <Button data-testid="button-new-rfq">
                  <Plus className="mr-2 h-4 w-4" /> {t.purchase.newRFQ}
                </Button>
              </Link>
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/purchase/rfq" className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
            <Card className="bg-card border-border transition-all hover:border-primary/50 hover:shadow-md group-hover:bg-accent/40 cursor-pointer h-full">
              <CardHeader className="flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t.purchase.rfq}</CardTitle>
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-rfq">{summary?.rfqCount ?? 0}</div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/purchase/orders" className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
            <Card className="bg-card border-border transition-all hover:border-primary/50 hover:shadow-md group-hover:bg-accent/40 cursor-pointer h-full">
              <CardHeader className="flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t.purchase.order}</CardTitle>
                <ShoppingBag className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-orders">{summary?.ordersCount ?? 0}</div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/purchase/vendor-invoices" className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
            <Card className="bg-card border-border transition-all hover:border-primary/50 hover:shadow-md group-hover:bg-accent/40 cursor-pointer h-full">
              <CardHeader className="flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Vendor Invoice</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-to-bill">{summary?.toBillCount ?? 0}</div>
                <p className="text-xs text-muted-foreground mt-1">Belum lunas</p>
              </CardContent>
            </Card>
          </Link>
          <Link href="/purchase/vendors" className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
            <Card className="bg-card border-border transition-all hover:border-primary/50 hover:shadow-md group-hover:bg-accent/40 cursor-pointer h-full">
              <CardHeader className="flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t.purchase.totalSpend}</CardTitle>
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-spend">{idr(summary?.totalSpend ?? 0)}</div>
                {summary?.topVendor && (
                  <p className="text-xs text-muted-foreground mt-1">Top: {summary.topVendor}</p>
                )}
              </CardContent>
            </Card>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t.purchase.recentDocuments}</CardTitle>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.purchase.noDocuments}</p>
            ) : (
              <div className="space-y-2">
                {recent.map((d) => (
                  <Link
                    key={d.id}
                    href={d.kind === "order" ? `/purchase/orders/${d.id}` : `/purchase/rfq/${d.id}`}
                  >
                    <div
                      className="flex items-center justify-between rounded-md border p-3 hover:bg-accent cursor-pointer"
                      data-testid={`recent-doc-${d.id}`}
                    >
                      <div>
                        <div className="font-medium">{d.docNumber}</div>
                        <div className="text-xs text-muted-foreground">{d.supplierName}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="capitalize">{d.kind}</Badge>
                        <Badge variant="secondary" className="capitalize">{d.status}</Badge>
                        <div className="font-medium">{idr(Number(d.totalAmount))}</div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
