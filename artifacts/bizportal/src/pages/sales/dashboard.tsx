import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useGetSalesSummary,
  useListSalesDocuments,
} from "@workspace/api-client-react";
import { FileText, ShoppingBag, Receipt, TrendingUp, Plus } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export default function SalesDashboardPage() {
  const { t } = useLanguage();
  const { data: summary } = useGetSalesSummary();
  const { data: _recentPaginated } = useListSalesDocuments({ limit: 8 });
  const recent = _recentPaginated?.data ?? [];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={t.sales.title}
          description={t.sales.subtitle}
          breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "Sales" }]}
          favoriteEnabled
          actions={
            <div className="flex gap-2">
              <Link href="/sales/quotations">
                <Button variant="outline" data-testid="link-go-quotations">
                  <FileText className="mr-2 h-4 w-4" /> {t.sales.quotation}
                </Button>
              </Link>
              <Link href="/sales/quotations">
                <Button data-testid="button-new-quote">
                  <Plus className="mr-2 h-4 w-4" /> {t.sales.newQuotation}
                </Button>
              </Link>
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/sales/quotations" className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
            <Card className="bg-card border-border transition-all hover:border-primary/50 hover:shadow-md group-hover:bg-accent/40 cursor-pointer h-full">
              <CardHeader className="flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t.sales.quotation}</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-quotations">{summary?.quotationsCount ?? 0}</div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/sales/orders" className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
            <Card className="bg-card border-border transition-all hover:border-primary/50 hover:shadow-md group-hover:bg-accent/40 cursor-pointer h-full">
              <CardHeader className="flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t.sales.order}</CardTitle>
                <ShoppingBag className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-orders">{summary?.ordersCount ?? 0}</div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/sales/invoices" className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
            <Card className="bg-card border-border transition-all hover:border-primary/50 hover:shadow-md group-hover:bg-accent/40 cursor-pointer h-full">
              <CardHeader className="flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t.sales.toInvoice}</CardTitle>
                <Receipt className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-to-invoice">{summary?.toInvoiceCount ?? 0}</div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/sales/customers" className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
            <Card className="bg-card border-border transition-all hover:border-primary/50 hover:shadow-md group-hover:bg-accent/40 cursor-pointer h-full">
              <CardHeader className="flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t.sales.revenue}</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-revenue">{idr(summary?.totalRevenue ?? 0)}</div>
                {summary?.topCustomer && (
                  <p className="text-xs text-muted-foreground mt-1">Top: {summary.topCustomer}</p>
                )}
              </CardContent>
            </Card>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t.sales.recentDocuments}</CardTitle>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.sales.noDocuments}</p>
            ) : (
              <div className="space-y-2">
                {recent.map((d) => (
                  <Link
                    key={d.id}
                    href={d.kind === "order" ? `/sales/orders/${d.id}` : `/sales/quotations/${d.id}`}
                  >
                    <div
                      className="flex items-center justify-between rounded-md border p-3 hover:bg-accent cursor-pointer"
                      data-testid={`recent-doc-${d.id}`}
                    >
                      <div>
                        <div className="font-medium">{d.docNumber}</div>
                        <div className="text-xs text-muted-foreground">{d.customerName}</div>
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
