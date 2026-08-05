import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Building, Pencil, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { useVendors } from "@/hooks/useVendors";
import {
  useListStocks,
  useCreateStockItem,
  useUpdateStockItem,
  useDeleteStockItem,
  useCreateSupplier,
  useUpdateSupplier,
  useDeleteSupplier,
  getListStocksQueryKey,
  type StockItem,
  type Supplier,
} from "@workspace/api-client-react";

export default function TradingPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: stocks, isLoading: isLoadingStocks } = useListStocks();
  const { data: suppliers, isLoading: isLoadingSuppliers } = useVendors();

  const createStock = useCreateStockItem();
  const updateStock = useUpdateStockItem();
  const deleteStock = useDeleteStockItem();
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();
  const deleteSupplier = useDeleteSupplier();

  const [isStockDialogOpen, setIsStockDialogOpen] = useState(false);
  const [isSupplierDialogOpen, setIsSupplierDialogOpen] = useState(false);
  const [editStock, setEditStock] = useState<StockItem | null>(null);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [confirmDeleteStock, setConfirmDeleteStock] = useState<StockItem | null>(null);
  const [confirmDeleteSupplier, setConfirmDeleteSupplier] = useState<Supplier | null>(null);

  const formatIDR = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(value);

  const refetchStocks = () => queryClient.invalidateQueries({ queryKey: getListStocksQueryKey() });
  const refetchSuppliers = () => queryClient.invalidateQueries({ queryKey: ["vendors-filtered"] });

  const handleCreateStock = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const supplierRaw = fd.get("supplierId") as string;
    createStock.mutate({
      data: {
        productName: fd.get("productName") as string,
        sku: fd.get("sku") as string,
        quantity: Number(fd.get("quantity")),
        unit: fd.get("unit") as string,
        costPrice: Number(fd.get("costPrice")),
        hsCode: (fd.get("hsCode") as string) || undefined,
        supplierId: supplierRaw && supplierRaw !== "none" ? Number(supplierRaw) : undefined,
      },
    }, {
      onSuccess: () => { refetchStocks(); setIsStockDialogOpen(false); toast({ title: t.common.success }); },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  };

  const handleEditStock = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editStock) return;
    const fd = new FormData(e.currentTarget);
    const supplierRaw = fd.get("supplierId") as string;
    updateStock.mutate({
      id: editStock.id,
      data: {
        productName: fd.get("productName") as string,
        sku: fd.get("sku") as string,
        quantity: Number(fd.get("quantity")),
        unit: fd.get("unit") as string,
        costPrice: Number(fd.get("costPrice")),
        hsCode: (fd.get("hsCode") as string) || undefined,
        supplierId: supplierRaw && supplierRaw !== "none" ? Number(supplierRaw) : undefined,
      },
    }, {
      onSuccess: () => { refetchStocks(); setEditStock(null); toast({ title: t.common.success }); },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  };

  const handleDeleteStock = () => {
    if (!confirmDeleteStock) return;
    deleteStock.mutate({ id: confirmDeleteStock.id }, {
      onSuccess: () => { refetchStocks(); setConfirmDeleteStock(null); toast({ title: t.common.success }); },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  };

  const handleCreateSupplier = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createSupplier.mutate({
      data: {
        name: fd.get("name") as string,
        country: fd.get("country") as string,
        contactEmail: fd.get("contactEmail") as string,
        phone: (fd.get("phone") as string) || undefined,
      },
    }, {
      onSuccess: () => { refetchSuppliers(); setIsSupplierDialogOpen(false); toast({ title: t.common.success }); },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  };

  const handleEditSupplier = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editSupplier) return;
    const fd = new FormData(e.currentTarget);
    updateSupplier.mutate({
      id: editSupplier.id,
      data: {
        name: fd.get("name") as string,
        country: fd.get("country") as string,
        contactEmail: fd.get("contactEmail") as string,
        phone: (fd.get("phone") as string) || undefined,
      },
    }, {
      onSuccess: () => { refetchSuppliers(); setEditSupplier(null); toast({ title: t.common.success }); },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  };

  const handleDeleteSupplier = () => {
    if (!confirmDeleteSupplier) return;
    deleteSupplier.mutate({ id: confirmDeleteSupplier.id }, {
      onSuccess: () => { refetchSuppliers(); setConfirmDeleteSupplier(null); toast({ title: t.common.success }); },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={t.trading.title}
          description={t.trading.subtitle}
          favoriteEnabled
        />

        <Tabs defaultValue="inventory" className="space-y-4">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="inventory" className="flex-1 sm:flex-none">{t.trading.inventory}</TabsTrigger>
            <TabsTrigger value="suppliers" className="flex-1 sm:flex-none">{t.trading.supplier}</TabsTrigger>
          </TabsList>

          {/* INVENTORY TAB */}
          <TabsContent value="inventory" className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <h2 className="text-lg sm:text-xl font-semibold tracking-tight">{t.trading.stockInventory}</h2>
              <Dialog open={isStockDialogOpen} onOpenChange={setIsStockDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-stock"><Plus className="mr-2 h-4 w-4" /> {t.trading.addStock}</Button>
                </DialogTrigger>
                <DialogContent>
                  <form onSubmit={handleCreateStock}>
                    <DialogHeader>
                      <DialogTitle>{t.trading.addStockTitle}</DialogTitle>
                      <DialogDescription>{t.trading.addStockDesc}</DialogDescription>
                    </DialogHeader>
                    <StockFormFields suppliers={suppliers ?? []} />
                    <DialogFooter>
                      <Button type="submit" disabled={createStock.isPending}>
                        {createStock.isPending ? t.common.saving : t.common.save}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            <Card className="hidden md:block">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.trading.productName} / SKU</TableHead>
                      <TableHead>{t.trading.hsCode}</TableHead>
                      <TableHead>{t.trading.supplier}</TableHead>
                      <TableHead className="text-right">{t.trading.quantity}</TableHead>
                      <TableHead className="text-right">{t.trading.costPrice}</TableHead>
                      <TableHead className="text-right w-[100px]">{t.common.actions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingStocks ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                          <TableCell className="text-right"><Skeleton className="h-4 w-[60px] ml-auto" /></TableCell>
                          <TableCell className="text-right"><Skeleton className="h-4 w-[100px] ml-auto" /></TableCell>
                          <TableCell></TableCell>
                        </TableRow>
                      ))
                    ) : stocks?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="h-24 text-center">
                          <div className="flex flex-col items-center justify-center text-muted-foreground">
                            <img src="/images/logo.png" alt="B2B Marketplace and Logistic" className="h-8 w-auto mb-2 object-contain opacity-50 mx-auto" />
                            <p>{t.trading.noStock}</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      stocks?.map((item) => (
                        <TableRow key={item.id} data-testid={`row-stock-${item.id}`}>
                          <TableCell>
                            <div className="font-medium">{item.productName}</div>
                            <div className="text-xs text-muted-foreground">{item.sku}</div>
                          </TableCell>
                          <TableCell>{item.hsCode || '-'}</TableCell>
                          <TableCell>{item.supplierName || '-'}</TableCell>
                          <TableCell className="text-right font-medium">{item.quantity} {item.unit}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{formatIDR(item.costPrice)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="icon" variant="ghost" onClick={() => setEditStock(item)} data-testid={`button-edit-stock-${item.id}`} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" onClick={() => setConfirmDeleteStock(item)} data-testid={`button-delete-stock-${item.id}`} aria-label="Delete" className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="md:hidden space-y-3">
              {isLoadingStocks ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i}><CardContent className="p-4 space-y-2">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-1/2" />
                  </CardContent></Card>
                ))
              ) : !stocks || stocks.length === 0 ? (
                <Card><CardContent className="p-8 text-center">
                  <img src="/images/logo.png" alt="B2B Marketplace and Logistic" className="h-8 w-auto mb-2 object-contain opacity-50 mx-auto" />
                  <p className="text-sm text-muted-foreground">{t.trading.noStock}</p>
                </CardContent></Card>
              ) : (
                stocks.map((item) => (
                  <Card key={item.id} data-testid={`card-stock-${item.id}`}><CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{item.productName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.sku}</p>
                      </div>
                      {item.hsCode && <Badge variant="outline" className="shrink-0 text-xs">HS {item.hsCode}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{t.trading.supplier}: <span className="text-foreground">{item.supplierName || '-'}</span></p>
                    <div className="flex justify-between items-end pt-1 border-t border-border">
                      <div>
                        <p className="text-xs text-muted-foreground">{t.trading.quantity}</p>
                        <p className="text-sm font-medium">{item.quantity} {item.unit}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">{t.trading.costPrice}</p>
                        <p className="text-sm font-medium">{formatIDR(item.costPrice)}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditStock(item)} data-testid={`button-edit-stock-mobile-${item.id}`}>
                        <Pencil className="h-3.5 w-3.5 mr-1.5" /> {t.common.edit}
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 text-destructive hover:text-destructive" onClick={() => setConfirmDeleteStock(item)} data-testid={`button-delete-stock-mobile-${item.id}`}>
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" /> {t.common.delete}
                      </Button>
                    </div>
                  </CardContent></Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* SUPPLIERS TAB */}
          <TabsContent value="suppliers" className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <h2 className="text-lg sm:text-xl font-semibold tracking-tight">{t.trading.supplierName}</h2>
              <Dialog open={isSupplierDialogOpen} onOpenChange={setIsSupplierDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-supplier"><Plus className="mr-2 h-4 w-4" /> {t.trading.addSupplier}</Button>
                </DialogTrigger>
                <DialogContent>
                  <form onSubmit={handleCreateSupplier}>
                    <DialogHeader>
                      <DialogTitle>{t.trading.addSupplierTitle}</DialogTitle>
                    </DialogHeader>
                    <SupplierFormFields />
                    <DialogFooter>
                      <Button type="submit" disabled={createSupplier.isPending}>
                        {createSupplier.isPending ? t.common.saving : t.common.save}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            <Card className="hidden md:block">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.trading.supplierName}</TableHead>
                      <TableHead>{t.trading.country}</TableHead>
                      <TableHead>{t.common.email}</TableHead>
                      <TableHead>{t.common.phone}</TableHead>
                      <TableHead className="text-right w-[100px]">{t.common.actions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingSuppliers ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                          <TableCell></TableCell>
                        </TableRow>
                      ))
                    ) : suppliers?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center">
                          <div className="flex flex-col items-center justify-center text-muted-foreground">
                            <Building className="h-8 w-8 mb-2 opacity-50" />
                            <p>{t.trading.noSuppliers}</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      suppliers?.map((s) => (
                        <TableRow key={s.id} data-testid={`row-supplier-${s.id}`}>
                          <TableCell className="font-medium">{s.name}</TableCell>
                          <TableCell><Badge variant="outline">{s.country}</Badge></TableCell>
                          <TableCell className="text-muted-foreground">{s.contactEmail}</TableCell>
                          <TableCell>{s.phone || '-'}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="icon" variant="ghost" onClick={() => setEditSupplier(s)} data-testid={`button-edit-supplier-${s.id}`} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" onClick={() => setConfirmDeleteSupplier(s)} data-testid={`button-delete-supplier-${s.id}`} aria-label="Delete" className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="md:hidden space-y-3">
              {isLoadingSuppliers ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i}><CardContent className="p-4 space-y-2">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-1/2" />
                  </CardContent></Card>
                ))
              ) : !suppliers || suppliers.length === 0 ? (
                <Card><CardContent className="p-8 text-center">
                  <Building className="h-8 w-8 mb-2 opacity-50 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{t.trading.noSuppliers}</p>
                </CardContent></Card>
              ) : (
                suppliers.map((s) => (
                  <Card key={s.id} data-testid={`card-supplier-${s.id}`}><CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium truncate">{s.name}</p>
                      <Badge variant="outline" className="shrink-0">{s.country}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{s.contactEmail}</p>
                    {s.phone && <p className="text-xs">{s.phone}</p>}
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditSupplier(s)} data-testid={`button-edit-supplier-mobile-${s.id}`}>
                        <Pencil className="h-3.5 w-3.5 mr-1.5" /> {t.common.edit}
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 text-destructive hover:text-destructive" onClick={() => setConfirmDeleteSupplier(s)} data-testid={`button-delete-supplier-mobile-${s.id}`}>
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" /> {t.common.delete}
                      </Button>
                    </div>
                  </CardContent></Card>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* EDIT STOCK DIALOG */}
      <Dialog open={!!editStock} onOpenChange={(o) => !o && setEditStock(null)}>
        <DialogContent>
          {editStock && (
            <form onSubmit={handleEditStock}>
              <DialogHeader>
                <DialogTitle>{t.trading.editStockTitle}</DialogTitle>
              </DialogHeader>
              <StockFormFields defaults={editStock} suppliers={suppliers ?? []} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditStock(null)}>{t.common.cancel}</Button>
                <Button type="submit" disabled={updateStock.isPending} data-testid="button-save-stock">
                  {updateStock.isPending ? t.common.saving : t.common.save}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* DELETE STOCK ALERT */}
      <AlertDialog open={!!confirmDeleteStock} onOpenChange={(o) => !o && setConfirmDeleteStock(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.common.confirmDeleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeleteStock && `"${confirmDeleteStock.productName}" ${t.common.confirmDeleteDesc}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteStock} className="bg-destructive hover:bg-destructive/90" data-testid="button-confirm-delete-stock">{t.common.delete}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* EDIT SUPPLIER DIALOG */}
      <Dialog open={!!editSupplier} onOpenChange={(o) => !o && setEditSupplier(null)}>
        <DialogContent>
          {editSupplier && (
            <form onSubmit={handleEditSupplier}>
              <DialogHeader>
                <DialogTitle>{t.trading.editSupplierTitle}</DialogTitle>
              </DialogHeader>
              <SupplierFormFields defaults={editSupplier} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditSupplier(null)}>{t.common.cancel}</Button>
                <Button type="submit" disabled={updateSupplier.isPending} data-testid="button-save-supplier">
                  {updateSupplier.isPending ? t.common.saving : t.common.save}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* DELETE SUPPLIER ALERT */}
      <AlertDialog open={!!confirmDeleteSupplier} onOpenChange={(o) => !o && setConfirmDeleteSupplier(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.common.confirmDeleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeleteSupplier && `"${confirmDeleteSupplier.name}" ${t.common.confirmDeleteDesc}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSupplier} className="bg-destructive hover:bg-destructive/90" data-testid="button-confirm-delete-supplier">{t.common.delete}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function StockFormFields({ defaults, suppliers }: { defaults?: StockItem; suppliers: Supplier[] }) {
  const { t } = useLanguage();
  const [supplierId, setSupplierId] = useState<string>(
    defaults?.supplierId != null ? String(defaults.supplierId) : "none"
  );
  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <Label htmlFor="productName">{t.trading.productName}</Label>
        <Input id="productName" name="productName" defaultValue={defaults?.productName ?? ""} required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="sku">{t.trading.sku}</Label>
          <Input id="sku" name="sku" defaultValue={defaults?.sku ?? ""} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="hsCode">{t.trading.hsCode}</Label>
          <Input id="hsCode" name="hsCode" defaultValue={defaults?.hsCode ?? ""} placeholder={t.common.optional} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="quantity">{t.trading.quantity}</Label>
          <Input id="quantity" name="quantity" type="number" min="0" defaultValue={defaults?.quantity ?? 0} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="unit">{t.trading.unit}</Label>
          <Input id="unit" name="unit" defaultValue={defaults?.unit ?? ""} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="costPrice">{t.trading.costPrice}</Label>
          <Input id="costPrice" name="costPrice" type="number" min="0" defaultValue={defaults?.costPrice ?? 0} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="supplierId">{t.trading.supplier}</Label>
          <input type="hidden" name="supplierId" value={supplierId} />
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger id="supplierId" data-testid="select-supplier">
              <SelectValue placeholder={`(${t.common.optional})`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— {t.trading.noSuppliers} —</SelectItem>
              {suppliers.map(s => (
                <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function SupplierFormFields({ defaults }: { defaults?: Supplier }) {
  const { t } = useLanguage();
  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <Label htmlFor="name">{t.trading.supplierName}</Label>
        <Input id="name" name="name" defaultValue={defaults?.name ?? ""} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="country">{t.trading.country}</Label>
        <Input id="country" name="country" defaultValue={defaults?.country ?? ""} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="contactEmail">{t.common.contactEmail}</Label>
        <Input id="contactEmail" name="contactEmail" type="email" defaultValue={defaults?.contactEmail ?? ""} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="phone">{t.common.phone}</Label>
        <Input id="phone" name="phone" defaultValue={defaults?.phone ?? ""} />
      </div>
    </div>
  );
}
