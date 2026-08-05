import { assertSapSource } from "@/lib/sapLock";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  useListProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useListOrders,
  useCreateOrder,
  useUpdateOrder,
  useDeleteOrder,
  useListTaxes,
  useGetAccountingSettings,
  useListProductCategories,
  useCreateProductCategory,
  useUpdateProductCategory,
  useDeleteProductCategory,
  getListProductsQueryKey,
  getListOrdersQueryKey,
  getListProductCategoriesQueryKey,
  type Product,
  type Order,
  type AccountingTax,
  type ProductCategory,
} from "@workspace/api-client-react";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, ShoppingBag, Pencil, Trash2, Printer, Search, ChevronDown, X, RefreshCw, Clock, ExternalLink, Database, Copy, CheckCheck, Link, Check } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@workspace/object-storage-web";
import { ImagePlus, ImageIcon, Loader2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

const ORDER_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled"] as const;
type OrderStatus = typeof ORDER_STATUSES[number];
type LineItemRow = { id: string; name: string; qty: number; unitPrice: number };

const ORDER_REFRESH_LS_KEY = "ecommerce-order-refresh-interval";
const ORDER_REFRESH_OPTIONS = [
  { label: "30 detik", value: "30000" },
  { label: "1 menit", value: "60000" },
  { label: "5 menit", value: "300000" },
  { label: "Mati", value: "off" },
] as const;
type OrderRefreshValue = typeof ORDER_REFRESH_OPTIONS[number]["value"];

function getInitialOrderRefreshInterval(): OrderRefreshValue {
  try {
    const stored = localStorage.getItem(ORDER_REFRESH_LS_KEY);
    if (stored && ORDER_REFRESH_OPTIONS.some((o) => o.value === stored)) return stored as OrderRefreshValue;
  } catch { /* ignore */ }
  return "60000";
}

const formatIDR = (v: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

function ProductAutocomplete({
  value,
  onChange,
  onSelect,
  products,
  placeholder,
  className,
  "data-testid": testId,
}: {
  value: string;
  onChange: (name: string) => void;
  onSelect: (name: string, price: number) => void;
  products: Product[];
  placeholder?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const [open, setOpen] = useState(false);
  const filtered = value.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(value.trim().toLowerCase())).slice(0, 8)
    : [];

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
        placeholder={placeholder}
        className={className}
        data-testid={testId}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 left-0 top-full mt-0.5 w-56 rounded-md border bg-popover shadow-md overflow-hidden">
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              className="flex w-full items-center justify-between px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer text-left"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(p.name, p.price);
                setOpen(false);
              }}
            >
              <span className="truncate max-w-[140px]">{p.name}</span>
              <span className="ml-2 shrink-0 text-xs text-muted-foreground tabular-nums">{formatIDR(p.price)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EcommercePage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();
  const search = useSearch();
  const [, setLocation] = useLocation();

  const initialParams = new URLSearchParams(search);

  const initialTab = (() => {
    const t = initialParams.get("tab");
    return t === "orders" || t === "categories" ? t : "products";
  })();
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  const syncUrl = (overrides: {
    tab?: string;
    search?: string;
    orderSearch?: string;
    orderStatus?: string;
    salesTax?: string;
    purchaseTax?: string;
    categories?: string[];
  }) => {
    const params = new URLSearchParams(window.location.search);
    const tab = overrides.tab ?? params.get("tab") ?? "";
    const productSearchVal = "search" in overrides ? overrides.search! : (params.get("search") ?? "");
    const orderSearchVal = "orderSearch" in overrides ? overrides.orderSearch! : (params.get("orderSearch") ?? "");
    const orderStatusVal = "orderStatus" in overrides ? overrides.orderStatus! : (params.get("orderStatus") ?? "all");
    const salesTaxVal = "salesTax" in overrides ? overrides.salesTax! : (params.get("salesTax") ?? "all");
    const purchaseTaxVal = "purchaseTax" in overrides ? overrides.purchaseTax! : (params.get("purchaseTax") ?? "all");
    const categoriesVal = "categories" in overrides ? overrides.categories! : (params.get("categories") ? params.get("categories")!.split(",").filter(Boolean) : []);

    if (tab === "orders") params.set("tab", "orders");
    else if (tab === "categories") params.set("tab", "categories");
    else params.delete("tab");

    if (productSearchVal) params.set("search", productSearchVal);
    else params.delete("search");

    if (orderSearchVal) params.set("orderSearch", orderSearchVal);
    else params.delete("orderSearch");

    if (orderStatusVal && orderStatusVal !== "all") params.set("orderStatus", orderStatusVal);
    else params.delete("orderStatus");

    if (salesTaxVal && salesTaxVal !== "all") params.set("salesTax", salesTaxVal);
    else params.delete("salesTax");

    if (purchaseTaxVal && purchaseTaxVal !== "all") params.set("purchaseTax", purchaseTaxVal);
    else params.delete("purchaseTax");

    if (categoriesVal.length > 0) params.set("categories", categoriesVal.join(","));
    else params.delete("categories");

    const qs = params.toString();
    setLocation(qs ? `/ecommerce?${qs}` : `/ecommerce`, { replace: true });
  };

  useEffect(() => {
    const params = new URLSearchParams(search);
    const t = params.get("tab");
    const next = t === "orders" || t === "categories" || t === "products" ? t : "products";
    setActiveTab((prev) => (prev !== next ? next : prev));
    setProductSearch(params.get("search") ?? "");
    setOrderSearch(params.get("orderSearch") ?? "");
    setOrderStatusFilter(params.get("orderStatus") ?? "all");
    setFilterSalesTaxId(params.get("salesTax") ?? "all");
    setFilterPurchaseTaxId(params.get("purchaseTax") ?? "all");
    setFilterCategories(params.get("categories") ? params.get("categories")!.split(",").filter(Boolean) : []);
  }, [search]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    syncUrl({ tab: value, categories: filterCategories });
  };

  const { data: _productsPaginated, isLoading: isLoadingProducts } = useListProducts({ limit: 500 }, {
    query: { queryKey: getListProductsQueryKey() }
  });
  const products = _productsPaginated?.data;

  const { data: productCategories = [] as ProductCategory[], isLoading: isLoadingCategories } = useListProductCategories({
    query: { queryKey: getListProductCategoriesQueryKey() }
  });

  const createProductCategory = useCreateProductCategory();
  const updateProductCategory = useUpdateProductCategory();
  const deleteProductCategory = useDeleteProductCategory();

  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ProductCategory | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<ProductCategory | null>(null);
  const [createCategoryName, setCreateCategoryName] = useState("");
  const [editCategoryName, setEditCategoryName] = useState("");

  const [orderRefreshInterval, setOrderRefreshInterval] = useState<OrderRefreshValue>(getInitialOrderRefreshInterval);
  const [orderSecondsLeft, setOrderSecondsLeft] = useState<number | null>(null);
  const orderRefetchIntervalMs = orderRefreshInterval === "off" ? false : Number(orderRefreshInterval);

  const { data: orders, isLoading: isLoadingOrders, isFetching: isOrdersFetching, refetch: refetchOrders, dataUpdatedAt: ordersUpdatedAt } = useListOrders({
    query: { queryKey: getListOrdersQueryKey(), refetchInterval: orderRefetchIntervalMs }
  });

  useEffect(() => {
    if (orderRefreshInterval === "off" || !ordersUpdatedAt) {
      setOrderSecondsLeft(null);
      return;
    }
    const intervalMs = Number(orderRefreshInterval);
    const tick = () => {
      const remaining = Math.round((ordersUpdatedAt + intervalMs - Date.now()) / 1000);
      setOrderSecondsLeft(Math.max(0, remaining));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [ordersUpdatedAt, orderRefreshInterval]);

  const formatOrderCountdown = (secs: number): string => {
    if (secs <= 0) return "sebentar lagi";
    if (secs < 60) return `${secs}d`;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s > 0 ? `${m}m ${s}d` : `${m}m`;
  };

  const handleOrderRefreshIntervalChange = (value: string) => {
    const v = value as OrderRefreshValue;
    setOrderRefreshInterval(v);
    try { localStorage.setItem(ORDER_REFRESH_LS_KEY, v); } catch { /* ignore */ }
  };

  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const createOrder = useCreateOrder();
  const updateOrder = useUpdateOrder();
  const deleteOrder = useDeleteOrder();

  const [isProductDialogOpen, setIsProductDialogOpen] = useState(false);
  const [isOrderDialogOpen, setIsOrderDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editOrderStatus, setEditOrderStatus] = useState<OrderStatus>("pending");
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);
  const [printingOrder, setPrintingOrder] = useState<Order | null>(null);
  const [createImageUrl, setCreateImageUrl] = useState<string | null>(null);
  const [editImageUrl, setEditImageUrl] = useState<string | null>(null);

  const newLineItem = (): LineItemRow => ({ id: crypto.randomUUID(), name: "", qty: 1, unitPrice: 0 });

  const [createLineItems, setCreateLineItems] = useState<LineItemRow[]>([newLineItem()]);
  const [editLineItems, setEditLineItems] = useState<LineItemRow[]>([newLineItem()]);
  const [editLineItemsTouched, setEditLineItemsTouched] = useState(false);

  const createSubtotal = createLineItems.reduce((s, li) => s + li.qty * li.unitPrice, 0);
  const [createTaxRateId, setCreateTaxRateId] = useState<string>("none");
  const [createTaxAmount, setCreateTaxAmount] = useState(0);

  const [editSubtotal, setEditSubtotal] = useState(0);
  const [editTaxRateId, setEditTaxRateId] = useState<string>("none");
  const [editTaxAmount, setEditTaxAmount] = useState(0);

  const { data: allTaxes = [] as AccountingTax[] } = useListTaxes();
  const { data: accountingSettings } = useGetAccountingSettings();
  const saleTaxes = allTaxes.filter((t) => t.kind === "sale" && t.isActive);
  const purchaseTaxes = allTaxes.filter((t) => t.kind === "purchase" && t.isActive);

  const [createProdSalesTaxId, setCreateProdSalesTaxId] = useState<number | null>(null);
  const [createProdPurchaseTaxId, setCreateProdPurchaseTaxId] = useState<number | null>(null);
  const [editProdSalesTaxId, setEditProdSalesTaxId] = useState<number | null>(null);
  const [editProdPurchaseTaxId, setEditProdPurchaseTaxId] = useState<number | null>(null);
  const [createProdCategories, setCreateProdCategories] = useState<string[]>([]);
  const [editProdCategories, setEditProdCategories] = useState<string[]>([]);

  const [createWeightKg, setCreateWeightKg] = useState("");
  const [createLengthCm, setCreateLengthCm] = useState("");
  const [createWidthCm, setCreateWidthCm] = useState("");
  const [createHeightCm, setCreateHeightCm] = useState("");
  const [createGoodsType, setCreateGoodsType] = useState("");
  const [editWeightKg, setEditWeightKg] = useState("");
  const [editLengthCm, setEditLengthCm] = useState("");
  const [editWidthCm, setEditWidthCm] = useState("");
  const [editHeightCm, setEditHeightCm] = useState("");
  const [editGoodsType, setEditGoodsType] = useState("");

  const [filterSalesTaxId, setFilterSalesTaxId] = useState<string>(() => initialParams.get("salesTax") ?? "all");
  const [filterPurchaseTaxId, setFilterPurchaseTaxId] = useState<string>(() => initialParams.get("purchaseTax") ?? "all");
  const [filterCategories, setFilterCategories] = useState<string[]>(() => {
    const c = initialParams.get("categories");
    return c ? c.split(",").filter(Boolean) : [];
  });
  const [productSearch, setProductSearch] = useState<string>(() => initialParams.get("search") ?? "");
  const [orderSearch, setOrderSearch] = useState<string>(() => initialParams.get("orderSearch") ?? "");
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>(() => initialParams.get("orderStatus") ?? "all");
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<number>>(new Set());
  const toggleOrderExpand = (id: number) =>
    setExpandedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const filteredOrders = (orders ?? []).filter((o) => {
    if (orderStatusFilter !== "all" && o.status !== orderStatusFilter) return false;
    if (!orderSearch.trim()) return true;
    const q = orderSearch.trim().toLowerCase();
    const orderId = `#ORD-${o.id.toString().padStart(4, "0")}`.toLowerCase();
    return (
      orderId.includes(q) ||
      (o.customerName ?? "").toLowerCase().includes(q) ||
      (o.customerEmail ?? "").toLowerCase().includes(q)
    );
  });

  const filteredProducts = (products ?? []).filter((p) => {
    if (productSearch.trim()) {
      const q = productSearch.trim().toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !(p.sku ?? "").toLowerCase().includes(q)) return false;
    }
    if (filterSalesTaxId !== "all") {
      if (filterSalesTaxId === "none") {
        if (p.defaultSalesTaxId != null) return false;
      } else {
        if (String(p.defaultSalesTaxId) !== filterSalesTaxId) return false;
      }
    }
    if (filterPurchaseTaxId !== "all") {
      if (filterPurchaseTaxId === "none") {
        if (p.defaultPurchaseTaxId != null) return false;
      } else {
        if (String(p.defaultPurchaseTaxId) !== filterPurchaseTaxId) return false;
      }
    }
    if (filterCategories.length > 0 && !filterCategories.some((cat) => (p.categories ?? []).includes(cat))) return false;
    return true;
  });

  const defaultSalesTaxIdRef = useRef<number | null | undefined>(undefined);
  defaultSalesTaxIdRef.current = accountingSettings?.defaultSalesTaxId;

  const createImageUploader = useUpload({
    onSuccess: (res) => {
      setCreateImageUrl(res.objectPath);
      toast({ title: t.common.success });
    },
    onError: () => toast({ title: t.common.error, variant: "destructive" }),
  });
  const editImageUploader = useUpload({
    onSuccess: (res) => {
      setEditImageUrl(res.objectPath);
      toast({ title: t.common.success });
    },
    onError: () => toast({ title: t.common.error, variant: "destructive" }),
  });

  const resolveImage = (url?: string | null) => {
    if (!url) return null;
    if (url.startsWith("/objects/")) return `/api/storage${url}`;
    if (url.startsWith("/api/")) return url;
    return url;
  };

  const getOrderStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20';
      case 'processing': return 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 border-blue-500/20';
      case 'shipped': return 'bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 border-indigo-500/20';
      case 'delivered': return 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20';
      case 'cancelled': return 'bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const handleCreateProduct = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createProduct.mutate({
      data: {
        name: formData.get("name") as string,
        sku: formData.get("sku") as string,
        price: Number(formData.get("price")),
        stock: Number(formData.get("stock")),
        categories: createProdCategories,
        imageUrl: createImageUrl,
        defaultSalesTaxId: createProdSalesTaxId,
        defaultPurchaseTaxId: createProdPurchaseTaxId,
        itemType: "barang",
        unit: "pcs",
        weightKg: createWeightKg ? parseFloat(createWeightKg) : undefined,
        lengthCm: createLengthCm ? parseFloat(createLengthCm) : undefined,
        widthCm: createWidthCm ? parseFloat(createWidthCm) : undefined,
        heightCm: createHeightCm ? parseFloat(createHeightCm) : undefined,
        goodsType: createGoodsType || undefined,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        setIsProductDialogOpen(false);
        setCreateImageUrl(null);
        setCreateProdSalesTaxId(null);
        setCreateProdPurchaseTaxId(null);
        setCreateProdCategories([]);
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  };

  const handleEditProduct = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingProduct) return;
    const formData = new FormData(e.currentTarget);
    updateProduct.mutate({
      id: editingProduct.id,
      data: {
        name: formData.get("name") as string,
        sku: formData.get("sku") as string,
        price: Number(formData.get("price")),
        stock: Number(formData.get("stock")),
        categories: editProdCategories,
        imageUrl: editImageUrl,
        defaultSalesTaxId: editProdSalesTaxId,
        defaultPurchaseTaxId: editProdPurchaseTaxId,
        itemType: editingProduct.itemType ?? "barang",
        unit: editingProduct.unit ?? "pcs",
        weightKg: editWeightKg ? parseFloat(editWeightKg) : null,
        lengthCm: editLengthCm ? parseFloat(editLengthCm) : null,
        widthCm: editWidthCm ? parseFloat(editWidthCm) : null,
        heightCm: editHeightCm ? parseFloat(editHeightCm) : null,
        goodsType: editGoodsType || null,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        setEditingProduct(null);
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  };

  useEffect(() => {
    if (!isProductDialogOpen) {
      setCreateImageUrl(null);
      setCreateWeightKg(""); setCreateLengthCm(""); setCreateWidthCm(""); setCreateHeightCm(""); setCreateGoodsType("");
    }
  }, [isProductDialogOpen]);

  useEffect(() => {
    setEditImageUrl(editingProduct?.imageUrl ?? null);
    setEditProdSalesTaxId(editingProduct?.defaultSalesTaxId ?? null);
    setEditProdPurchaseTaxId(editingProduct?.defaultPurchaseTaxId ?? null);
    setEditProdCategories(editingProduct?.categories ?? []);
    setEditWeightKg(editingProduct?.weightKg != null ? String(editingProduct.weightKg) : "");
    setEditLengthCm(editingProduct?.lengthCm != null ? String(editingProduct.lengthCm) : "");
    setEditWidthCm(editingProduct?.widthCm != null ? String(editingProduct.widthCm) : "");
    setEditHeightCm(editingProduct?.heightCm != null ? String(editingProduct.heightCm) : "");
    setEditGoodsType(editingProduct?.goodsType ?? "");
  }, [editingProduct]);

  const handleCreateCategory = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    createProductCategory.mutate({ data: { name: createCategoryName.trim() } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductCategoriesQueryKey() });
        setIsCategoryDialogOpen(false);
        setCreateCategoryName("");
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  };

  const handleEditCategory = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingCategory) return;
    updateProductCategory.mutate({ id: editingCategory.id, data: { name: editCategoryName.trim() } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductCategoriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        setEditingCategory(null);
        setEditCategoryName("");
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  };

  const handleConfirmDeleteCategory = () => {
    if (!deletingCategory) return;
    const id = deletingCategory.id;
    deleteProductCategory.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductCategoriesQueryKey() });
        setDeletingCategory(null);
        toast({ title: t.common.success });
      },
      onError: (err: unknown) => {
        setDeletingCategory(null);
        const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
        toast({ title: msg ?? t.common.error, variant: "destructive" });
      },
    });
  };

  const handleConfirmDeleteProduct = () => {
    if (!deletingProduct) return;
    const id = deletingProduct.id;
    deleteProduct.mutate({ id }, {
      onSuccess: () => {
        queryClient.setQueryData<Product[]>(getListProductsQueryKey(), (old) => old?.filter(p => p.id !== id) ?? []);
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        setDeletingProduct(null);
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  };

  const computeTax = (subtotal: number, taxRateId: string): number => {
    if (!taxRateId) return 0;
    const tax = saleTaxes.find((t) => String(t.id) === taxRateId);
    if (!tax) return 0;
    return Math.round((subtotal * Number(tax.rate)) / 100);
  };

  const handleCreateTaxRateChange = (val: string) => {
    const rateId = val === "none" ? "" : val;
    setCreateTaxRateId(rateId);
    setCreateTaxAmount(rateId ? computeTax(createSubtotal, rateId) : 0);
  };

  const handleEditTaxRateChange = (val: string) => {
    const rateId = val === "none" ? "" : val;
    setEditTaxRateId(rateId);
    setEditTaxAmount(rateId ? computeTax(editSubtotal, rateId) : 0);
  };

  const handleCreateOrder = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const validLineItems = createLineItems.filter((li) => li.name.trim());
    if (validLineItems.length === 0) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    const validSubtotal = validLineItems.reduce((s, li) => s + li.qty * li.unitPrice, 0);
    const validTax = createTaxRateId ? computeTax(validSubtotal, createTaxRateId) : createTaxAmount;
    createOrder.mutate({
      data: {
        customerName: formData.get("customerName") as string,
        customerEmail: formData.get("customerEmail") as string,
        customerPhone: (formData.get("customerPhone") as string) || undefined,
        lineItems: validLineItems.map(({ name, qty, unitPrice }) => ({ name, qty, unitPrice })),
        totalAmount: validSubtotal,
        taxAmount: validTax,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        setIsOrderDialogOpen(false);
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  };

  const handleEditOrder = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingOrder) return;
    const formData = new FormData(e.currentTarget);
    const validLineItems = editLineItems.filter((li) => li.name.trim());
    const finalLineItems = validLineItems.map(({ name, qty, unitPrice }) => ({ name, qty, unitPrice }));
    const finalSubtotal = finalLineItems.length > 0
      ? finalLineItems.reduce((s, li) => s + li.qty * li.unitPrice, 0)
      : editSubtotal;
    const finalTax = editTaxRateId ? computeTax(finalSubtotal, editTaxRateId) : editTaxAmount;
    updateOrder.mutate({
      id: editingOrder.id,
      data: {
        customerName: formData.get("customerName") as string,
        customerEmail: formData.get("customerEmail") as string,
        customerPhone: (formData.get("customerPhone") as string) || undefined,
        ...(finalLineItems.length > 0 ? { lineItems: finalLineItems } : {}),
        totalAmount: finalSubtotal,
        taxAmount: finalTax,
        status: editOrderStatus,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        setEditingOrder(null);
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  };

  const handleConfirmDeleteOrder = () => {
    if (!deletingOrder) return;
    const id = deletingOrder.id;
    deleteOrder.mutate({ id }, {
      onSuccess: () => {
        queryClient.setQueryData<Order[]>(getListOrdersQueryKey(), (old) => old?.filter(o => o.id !== id) ?? []);
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        setDeletingOrder(null);
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  };

  useEffect(() => {
    if (!isOrderDialogOpen) {
      setCreateLineItems([newLineItem()]);
      setCreateTaxRateId("");
      setCreateTaxAmount(0);
    } else {
      const defaultId = defaultSalesTaxIdRef.current;
      const validDefault = defaultId && saleTaxes.some((t) => t.id === defaultId);
      setCreateTaxRateId(validDefault ? String(defaultId) : "");
      setCreateLineItems([newLineItem()]);
      setCreateTaxAmount(0);
    }
  }, [isOrderDialogOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (createTaxRateId) setCreateTaxAmount(computeTax(createSubtotal, createTaxRateId));
  }, [createSubtotal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editLineItemsTouched) {
      const computed = editLineItems.reduce((s, li) => s + li.qty * li.unitPrice, 0);
      setEditSubtotal(computed);
      if (editTaxRateId) setEditTaxAmount(computeTax(computed, editTaxRateId));
    }
  }, [editLineItems, editLineItemsTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editLineItemsTouched && editTaxRateId) setEditTaxAmount(computeTax(editSubtotal, editTaxRateId));
  }, [editSubtotal]); // eslint-disable-line react-hooks/exhaustive-deps

  const openEditOrder = (order: Order) => {
    setEditingOrder(order);
    setEditOrderStatus((order.status as OrderStatus) ?? "pending");
    const lis = order.lineItems;
    if (lis && lis.length > 0) {
      setEditLineItems(lis.map((li) => ({ id: crypto.randomUUID(), name: li.name, qty: li.qty, unitPrice: li.unitPrice })));
      setEditSubtotal(lis.reduce((s, li) => s + li.qty * li.unitPrice, 0));
      setEditLineItemsTouched(true);
    } else {
      setEditLineItems([newLineItem()]);
      setEditSubtotal(order.totalAmount);
      setEditLineItemsTouched(false);
    }
    setEditTaxRateId("");
    setEditTaxAmount(order.taxAmount ?? 0);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="E-Commerce"
          description="Kelola katalog toko online dan pesanan pelanggan."
          favoriteEnabled
        />

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="products" className="flex-1 sm:flex-none" data-testid="tab-products">Produk</TabsTrigger>
            <TabsTrigger value="orders" className="flex-1 sm:flex-none" data-testid="tab-orders">Order</TabsTrigger>
            <TabsTrigger value="categories" className="flex-1 sm:flex-none" data-testid="tab-categories">Kategori</TabsTrigger>
          </TabsList>

          {/* PRODUCTS TAB */}
          <TabsContent value="products" className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Katalog Produk</h2>
              <Dialog open={isProductDialogOpen} onOpenChange={setIsProductDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-product"><Plus className="mr-2 h-4 w-4" /> Tambah Produk</Button>
                </DialogTrigger>
                <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg md:max-w-2xl max-h-[90vh] overflow-y-auto">
                  <form onSubmit={handleCreateProduct}>
                    <DialogHeader>
                      <DialogTitle>Tambah Produk Baru</DialogTitle>
                      <DialogDescription>Buat produk baru di katalog Anda.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2"><Label htmlFor="name">Nama Produk</Label><Input id="name" name="name" required data-testid="input-product-name" /></div>
                      <div className="grid gap-2"><Label htmlFor="sku">SKU</Label><Input id="sku" name="sku" required data-testid="input-product-sku" /></div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="grid gap-2"><Label htmlFor="price">Harga (IDR)</Label><Input id="price" name="price" type="number" min="0" required data-testid="input-product-price" /></div>
                        <div className="grid gap-2"><Label htmlFor="stock">Stok</Label><Input id="stock" name="stock" type="number" min="0" required data-testid="input-product-stock" /></div>
                      </div>
                      <div className="grid gap-2">
                        <Label>Kategori <span className="text-muted-foreground text-xs">(pilih satu atau lebih)</span></Label>
                        <div className="border rounded-md p-3 max-h-40 overflow-y-auto space-y-2" data-testid="create-product-categories">
                          {[...productCategories].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                            <div key={c.id} className={`flex items-center gap-2${c.productCount === 0 ? " opacity-50" : ""}`}>
                              <Checkbox
                                id={`create-cat-${c.id}`}
                                checked={createProdCategories.includes(c.name)}
                                onCheckedChange={(checked) => {
                                  setCreateProdCategories((prev) =>
                                    checked ? [...prev, c.name] : prev.filter((n) => n !== c.name)
                                  );
                                }}
                                data-testid={`create-cat-checkbox-${c.id}`}
                              />
                              <label htmlFor={`create-cat-${c.id}`} className="text-sm cursor-pointer">{c.name}</label>
                              <span className="text-xs text-muted-foreground tabular-nums">({c.productCount ?? 0})</span>
                            </div>
                          ))}
                          {productCategories.length === 0 && (
                            <p className="text-sm text-muted-foreground">Belum ada kategori. Buat kategori terlebih dahulu.</p>
                          )}
                        </div>
                      </div>
                      <ProductImageField
                        imageUrl={createImageUrl}
                        isUploading={createImageUploader.isUploading}
                        onPickFile={(file) => createImageUploader.uploadFile(file)}
                        onRemove={() => setCreateImageUrl(null)}
                        onSetUrl={(url) => setCreateImageUrl(url)}
                        resolveImage={resolveImage}
                        idPrefix="create"
                      />
                      <div className="grid gap-2">
                        <Label>Tarif Pajak Penjualan Default</Label>
                        <Select value={createProdSalesTaxId ? String(createProdSalesTaxId) : "none"} onValueChange={(v) => setCreateProdSalesTaxId(v === "none" ? null : parseInt(v))} data-testid="select-create-product-sales-tax">
                          <SelectTrigger><SelectValue placeholder="Tidak ada pajak default" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Tidak ada pajak default</SelectItem>
                            {saleTaxes.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label>Tarif Pajak Pembelian Default</Label>
                        <Select value={createProdPurchaseTaxId ? String(createProdPurchaseTaxId) : "none"} onValueChange={(v) => setCreateProdPurchaseTaxId(v === "none" ? null : parseInt(v))} data-testid="select-create-product-purchase-tax">
                          <SelectTrigger><SelectValue placeholder="Tidak ada pajak default" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Tidak ada pajak default</SelectItem>
                            {purchaseTaxes.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2 border rounded-md p-3 bg-muted/30">
                        <Label className="text-sm font-semibold">Berat &amp; Dimensi Pengiriman</Label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="grid gap-1">
                            <Label htmlFor="create-weight" className="text-xs">Berat (kg)</Label>
                            <Input id="create-weight" type="number" min="0" step="0.001" placeholder="0.000" value={createWeightKg} onChange={e => setCreateWeightKg(e.target.value)} />
                          </div>
                          <div className="grid gap-1">
                            <Label htmlFor="create-goods-type" className="text-xs">Jenis Barang</Label>
                            <Input id="create-goods-type" placeholder="mis. Elektronik" value={createGoodsType} onChange={e => setCreateGoodsType(e.target.value)} />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          <div className="grid gap-1">
                            <Label htmlFor="create-length" className="text-xs">Panjang (cm)</Label>
                            <Input id="create-length" type="number" min="0" step="0.01" placeholder="0" value={createLengthCm} onChange={e => setCreateLengthCm(e.target.value)} />
                          </div>
                          <div className="grid gap-1">
                            <Label htmlFor="create-width" className="text-xs">Lebar (cm)</Label>
                            <Input id="create-width" type="number" min="0" step="0.01" placeholder="0" value={createWidthCm} onChange={e => setCreateWidthCm(e.target.value)} />
                          </div>
                          <div className="grid gap-1">
                            <Label htmlFor="create-height" className="text-xs">Tinggi (cm)</Label>
                            <Input id="create-height" type="number" min="0" step="0.01" placeholder="0" value={createHeightCm} onChange={e => setCreateHeightCm(e.target.value)} />
                          </div>
                        </div>
                        {createWeightKg && parseFloat(createWeightKg) > 0 && createLengthCm && createWidthCm && createHeightCm && (
                          <p className="text-xs text-muted-foreground">
                            Volume: {((parseFloat(createLengthCm)||0)*(parseFloat(createWidthCm)||0)*(parseFloat(createHeightCm)||0)/1000000).toFixed(4)} m³
                          </p>
                        )}
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="submit" disabled={createProduct.isPending || createImageUploader.isUploading || createProdCategories.length === 0} data-testid="button-submit-product">
                        {createProduct.isPending ? "Menyimpan..." : "Buat Produk"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9"
                placeholder="Cari nama produk atau SKU..."
                value={productSearch}
                onChange={(e) => { setProductSearch(e.target.value); syncUrl({ search: e.target.value }); }}
                data-testid="input-product-search"
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={filterSalesTaxId} onValueChange={(v) => { setFilterSalesTaxId(v); syncUrl({ salesTax: v }); }} data-testid="filter-sales-tax">
                <SelectTrigger className="sm:w-[220px]" data-testid="filter-sales-tax-trigger">
                  <SelectValue placeholder="Filter Pajak Jual" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Pajak Jual</SelectItem>
                  <SelectItem value="none">Tanpa Pajak Jual</SelectItem>
                  {saleTaxes.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterPurchaseTaxId} onValueChange={(v) => { setFilterPurchaseTaxId(v); syncUrl({ purchaseTax: v }); }} data-testid="filter-purchase-tax">
                <SelectTrigger className="sm:w-[220px]" data-testid="filter-purchase-tax-trigger">
                  <SelectValue placeholder="Filter Pajak Beli" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Pajak Beli</SelectItem>
                  <SelectItem value="none">Tanpa Pajak Beli</SelectItem>
                  {purchaseTaxes.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="sm:w-[200px] justify-between font-normal"
                    data-testid="filter-category-trigger"
                  >
                    <span className="truncate">
                      {filterCategories.length === 0
                        ? "Semua Kategori"
                        : filterCategories.length === 1
                          ? filterCategories[0]
                          : `${filterCategories.length} kategori`}
                    </span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2" align="start" data-testid="filter-category-popover">
                  <div className="space-y-1">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                      onClick={() => { setFilterCategories([]); syncUrl({ categories: [] }); }}
                    >
                      <span className={`h-4 w-4 rounded-sm border flex items-center justify-center ${filterCategories.length === 0 ? "bg-primary border-primary" : "border-input"}`}>
                        {filterCategories.length === 0 && <span className="block h-2 w-2 bg-primary-foreground rounded-[2px]" />}
                      </span>
                      Semua Kategori
                    </button>
                    {[...productCategories]
                      .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name))
                      .map((pc) => (
                      <label
                        key={pc.name}
                        className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent cursor-pointer ${pc.productCount === 0 ? "opacity-50" : ""}`}
                        data-testid={`filter-category-option-${pc.name}`}
                      >
                        <Checkbox
                          checked={filterCategories.includes(pc.name)}
                          onCheckedChange={(checked) => {
                            setFilterCategories((prev) => {
                              const next = checked === true
                                ? prev.includes(pc.name) ? prev : [...prev, pc.name]
                                : prev.filter((c) => c !== pc.name);
                              syncUrl({ categories: next });
                              return next;
                            });
                          }}
                        />
                        <span className="flex-1">{pc.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{pc.productCount}</span>
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {filterCategories.length > 0 && (
              <div className="flex flex-wrap gap-2 items-center" data-testid="filter-category-chips">
                <span className="text-xs text-muted-foreground">Kategori:</span>
                {filterCategories.map((cat) => (
                  <Badge key={cat} variant="secondary" className="gap-1 pr-1">
                    {cat}
                    <button
                      type="button"
                      aria-label={`Hapus filter ${cat}`}
                      onClick={() => { setFilterCategories((prev) => { const next = prev.filter((c) => c !== cat); syncUrl({ categories: next }); return next; }); }}
                      className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                      data-testid={`chip-remove-category-${cat}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <button
                  type="button"
                  onClick={() => { setFilterCategories([]); syncUrl({ categories: [] }); }}
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  data-testid="clear-category-filters"
                >
                  Hapus semua
                </button>
              </div>
            )}

            <Card className="hidden md:block">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[64px]">Foto</TableHead>
                      <TableHead>Nama Produk</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead className="text-right">Harga</TableHead>
                      <TableHead className="text-right">Stok</TableHead>
                      <TableHead>Pajak Default (Jual)</TableHead>
                      <TableHead>Pajak Default (Beli)</TableHead>
                      <TableHead className="text-right w-[120px]">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingProducts ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-10 w-10 rounded-md" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                          <TableCell className="text-right"><Skeleton className="h-4 w-[80px] ml-auto" /></TableCell>
                          <TableCell className="text-right"><Skeleton className="h-4 w-[40px] ml-auto" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                          <TableCell className="text-right"><Skeleton className="h-8 w-[80px] ml-auto" /></TableCell>
                        </TableRow>
                      ))
                    ) : filteredProducts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="h-24 text-center">
                          <div className="flex flex-col items-center justify-center text-muted-foreground">
                            <img src="/images/logo.png" alt="B2B Marketplace and Logistic" className="h-8 w-auto mb-2 object-contain opacity-50 mx-auto" />
                            <p>{(productSearch.trim() || filterSalesTaxId !== "all" || filterPurchaseTaxId !== "all" || filterCategories.length > 0) ? "Tidak ada produk yang cocok dengan pencarian atau filter ini." : "Belum ada produk. Tambahkan produk pertama Anda."}</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredProducts.map((product) => (
                        <TableRow key={product.id} data-testid={`row-product-${product.id}`}>
                          <TableCell>
                            <ProductThumb src={resolveImage(product.imageUrl)} alt={product.name} />
                          </TableCell>
                          <TableCell className="font-medium">{product.name}</TableCell>
                          <TableCell>{product.sku}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {(product.categories ?? []).length > 0
                                ? (product.categories ?? []).map((cat) => <Badge key={cat} variant="outline">{cat}</Badge>)
                                : <span className="text-muted-foreground text-xs">—</span>
                              }
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{formatIDR(product.price)}</TableCell>
                          <TableCell className="text-right font-medium">
                            <span className={product.stock < 10 ? "text-destructive" : ""}>{product.stock}</span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {product.defaultSalesTaxId
                              ? (allTaxes.find((t) => t.id === product.defaultSalesTaxId)?.name ?? "—")
                              : "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {product.defaultPurchaseTaxId
                              ? (allTaxes.find((t) => t.id === product.defaultPurchaseTaxId)?.name ?? "—")
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="icon" variant="ghost"
                                aria-label="Buku ke Portal"
                                title="Buku ke Portal"
                                onClick={() => {
                                  const params = new URLSearchParams({
                                    commodity: product.name,
                                    productId: String(product.id),
                                    qty: "1",
                                    productPrice: String(product.price ?? 0),
                                    unit: product.unit ?? "pcs",
                                  });
                                  window.open(`/book?${params}`, "_blank");
                                }}
                              >
                                <ExternalLink className="h-4 w-4 text-blue-500" />
                              </Button>
                              <Button size="icon" variant="ghost" onClick={() => setEditingProduct(product)} data-testid={`button-edit-product-${product.id}`} aria-label="Edit produk">
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" onClick={() => setDeletingProduct(product)} data-testid={`button-delete-product-${product.id}`} aria-label="Hapus produk" className="text-destructive hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
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
              {isLoadingProducts ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i}><CardContent className="p-4 space-y-2">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-1/3" />
                  </CardContent></Card>
                ))
              ) : filteredProducts.length === 0 ? (
                <Card><CardContent className="p-8 text-center">
                  <img src="/images/logo.png" alt="B2B Marketplace and Logistic" className="h-8 w-auto mb-2 object-contain opacity-50 mx-auto" />
                  <p className="text-sm text-muted-foreground">{(productSearch.trim() || filterSalesTaxId !== "all" || filterPurchaseTaxId !== "all" || filterCategories.length > 0) ? "Tidak ada produk yang cocok dengan pencarian atau filter ini." : "Belum ada produk. Tambahkan produk pertama Anda."}</p>
                </CardContent></Card>
              ) : (
                filteredProducts.map((product) => (
                  <Card key={product.id} data-testid={`card-product-${product.id}`}><CardContent className="p-4 space-y-2">
                    <div className="flex items-start gap-3">
                      <ProductThumb src={resolveImage(product.imageUrl)} alt={product.name} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{product.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{product.sku}</p>
                      </div>
                      <div className="flex flex-wrap gap-1 shrink-0">
                        {(product.categories ?? []).map((cat) => <Badge key={cat} variant="outline">{cat}</Badge>)}
                      </div>
                    </div>
                    <div className="flex justify-between items-end pt-1 border-t border-border">
                      <div>
                        <p className="text-xs text-muted-foreground">Harga</p>
                        <p className="text-sm font-medium">{formatIDR(product.price)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Stok</p>
                        <p className={`text-sm font-medium ${product.stock < 10 ? "text-destructive" : ""}`}>{product.stock}</p>
                      </div>
                    </div>
                    <div className="pt-1">
                      <p className="text-xs text-muted-foreground">Pajak Default (Jual)</p>
                      <p className="text-sm">
                        {product.defaultSalesTaxId
                          ? (allTaxes.find((t) => t.id === product.defaultSalesTaxId)?.name ?? "—")
                          : "—"}
                      </p>
                    </div>
                    <div className="pt-1">
                      <p className="text-xs text-muted-foreground">Pajak Default (Beli)</p>
                      <p className="text-sm">
                        {product.defaultPurchaseTaxId
                          ? (allTaxes.find((t) => t.id === product.defaultPurchaseTaxId)?.name ?? "—")
                          : "—"}
                      </p>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditingProduct(product)} data-testid={`button-edit-product-mobile-${product.id}`}>
                        <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 text-destructive hover:text-destructive" onClick={() => setDeletingProduct(product)} data-testid={`button-delete-product-mobile-${product.id}`}>
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Hapus
                      </Button>
                    </div>
                  </CardContent></Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* ORDERS TAB */}
          <TabsContent value="orders" className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Order Terbaru</h2>
                {ordersUpdatedAt > 0 && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <span>Diperbarui: {new Date(ordersUpdatedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    {orderSecondsLeft !== null && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />
                          Refresh dalam {formatOrderCountdown(orderSecondsLeft)}
                        </span>
                      </>
                    )}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Select value={orderRefreshInterval} onValueChange={handleOrderRefreshIntervalChange}>
                  <SelectTrigger className="h-8 w-[120px] text-xs" data-testid="order-refresh-interval-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDER_REFRESH_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchOrders()}
                  disabled={isOrdersFetching}
                  data-testid="order-refresh-btn"
                  className="gap-1.5 h-8"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isOrdersFetching ? "animate-spin" : ""}`} />
                  {isOrdersFetching ? "Memuat..." : "Refresh"}
                </Button>
                <Dialog open={isOrderDialogOpen} onOpenChange={setIsOrderDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-order"><Plus className="mr-2 h-4 w-4" /> Tambah Order</Button>
                </DialogTrigger>
                <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg md:max-w-2xl max-h-[90vh] overflow-y-auto">
                  <form onSubmit={handleCreateOrder}>
                    <DialogHeader>
                      <DialogTitle>Buat Order Manual</DialogTitle>
                      <DialogDescription>Masukkan order pelanggan secara manual.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2"><Label htmlFor="customerName">Nama Pelanggan</Label><Input id="customerName" name="customerName" required data-testid="input-order-customer-name" /></div>
                      <div className="grid gap-2"><Label htmlFor="customerEmail">Email Pelanggan</Label><Input id="customerEmail" name="customerEmail" type="email" required data-testid="input-order-customer-email" /></div>
                      <div className="grid gap-2"><Label htmlFor="customerPhone">No. WhatsApp / HP <span className="text-muted-foreground font-normal text-xs">(opsional, untuk notifikasi)</span></Label><Input id="customerPhone" name="customerPhone" type="tel" placeholder="628xxxxxxxxxx" data-testid="input-order-customer-phone" /></div>
                      <div className="grid gap-1">
                        <Label>Item Pesanan</Label>
                        <div className="border rounded-md overflow-hidden overflow-x-auto">
                          <table className="w-full text-sm min-w-[320px]">
                            <thead className="bg-muted text-muted-foreground">
                              <tr>
                                <th className="text-left px-2 py-1.5 font-medium">Nama Item</th>
                                <th className="text-center px-2 py-1.5 font-medium w-16">Qty</th>
                                <th className="text-right px-2 py-1.5 font-medium w-28">Harga Satuan</th>
                                <th className="w-8"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {createLineItems.map((li, idx) => (
                                <tr key={li.id} className="border-t">
                                  <td className="px-2 py-1">
                                    <ProductAutocomplete
                                      value={li.name}
                                      onChange={(name) => setCreateLineItems((prev) => prev.map((r) => r.id === li.id ? { ...r, name } : r))}
                                      onSelect={(name, price) => setCreateLineItems((prev) => prev.map((r) => r.id === li.id ? { ...r, name, unitPrice: price } : r))}
                                      products={products ?? []}
                                      placeholder="Nama produk"
                                      className="h-7 text-sm border-0 shadow-none px-0 focus-visible:ring-0"
                                      data-testid={`input-order-item-name-${idx}`}
                                    />
                                  </td>
                                  <td className="px-2 py-1">
                                    <Input
                                      type="number"
                                      min="1"
                                      value={li.qty}
                                      onChange={(e) => setCreateLineItems((prev) => prev.map((r) => r.id === li.id ? { ...r, qty: Math.max(1, Number(e.target.value) || 1) } : r))}
                                      className="h-7 text-sm text-center border-0 shadow-none px-0 focus-visible:ring-0 w-14"
                                      data-testid={`input-order-item-qty-${idx}`}
                                    />
                                  </td>
                                  <td className="px-2 py-1">
                                    <Input
                                      type="number"
                                      min="0"
                                      value={li.unitPrice || ""}
                                      onChange={(e) => setCreateLineItems((prev) => prev.map((r) => r.id === li.id ? { ...r, unitPrice: Number(e.target.value) || 0 } : r))}
                                      placeholder="0"
                                      className="h-7 text-sm text-right border-0 shadow-none px-0 focus-visible:ring-0"
                                      data-testid={`input-order-item-price-${idx}`}
                                    />
                                  </td>
                                  <td className="px-1 py-1 text-center">
                                    {createLineItems.length > 1 && (
                                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => setCreateLineItems((prev) => prev.filter((r) => r.id !== li.id))}>
                                        <X className="h-3 w-3" />
                                      </Button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <Button type="button" variant="outline" size="sm" className="mt-1 w-full" onClick={() => setCreateLineItems((prev) => [...prev, newLineItem()])} data-testid="button-add-line-item">
                          <Plus className="h-3.5 w-3.5 mr-1.5" /> Tambah Item
                        </Button>
                      </div>
                      <div className="grid gap-2">
                        <Label>Subtotal (IDR)</Label>
                        <Input
                          type="number"
                          value={createSubtotal}
                          readOnly
                          className="bg-muted text-muted-foreground cursor-not-allowed"
                          data-testid="input-order-total"
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="create-tax-rate">Tarif PPN</Label>
                          <Select value={createTaxRateId} onValueChange={handleCreateTaxRateChange} data-testid="select-create-tax-rate">
                            <SelectTrigger id="create-tax-rate" data-testid="select-trigger-create-tax-rate"><SelectValue placeholder="Tidak ada PPN" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Tidak ada PPN</SelectItem>
                              {saleTaxes.map((t) => (
                                <SelectItem key={t.id} value={String(t.id)}>{t.name} ({Number(t.rate).toFixed(0)}%)</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="create-tax-amount">PPN (IDR)</Label>
                          <Input
                            id="create-tax-amount"
                            type="number"
                            min="0"
                            value={createTaxAmount}
                            readOnly
                            className="bg-muted text-muted-foreground cursor-not-allowed"
                            data-testid="input-order-tax"
                          />
                        </div>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="submit" disabled={createOrder.isPending} data-testid="button-submit-order">
                        {createOrder.isPending ? "Menyimpan..." : "Buat Order"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9"
                placeholder="Cari nama pelanggan, email, atau ID order..."
                value={orderSearch}
                onChange={(e) => { setOrderSearch(e.target.value); syncUrl({ orderSearch: e.target.value }); }}
                data-testid="input-order-search"
              />
            </div>

            <div className="flex flex-wrap gap-2" data-testid="order-status-filters">
              {(["all", "pending", "processing", "shipped", "delivered", "cancelled"] as const).map((s) => {
                const labels: Record<string, string> = { all: "Semua", pending: "Pending", processing: "Processing", shipped: "Shipped", delivered: "Delivered", cancelled: "Dibatalkan" };
                const active = orderStatusFilter === s;
                return (
                  <button
                    key={s}
                    data-testid={`filter-order-status-${s}`}
                    onClick={() => { setOrderStatusFilter(s); syncUrl({ orderStatus: s }); }}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      active
                        ? s === "all"
                          ? "bg-primary text-primary-foreground border-primary"
                          : s === "pending" ? "bg-amber-500/20 text-amber-400 border-amber-500/50"
                          : s === "processing" ? "bg-blue-500/20 text-blue-400 border-blue-500/50"
                          : s === "shipped" ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/50"
                          : s === "delivered" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50"
                          : "bg-destructive/20 text-destructive border-destructive/50"
                        : "bg-transparent text-muted-foreground border-border hover:border-muted-foreground"
                    }`}
                  >
                    {labels[s]}
                  </button>
                );
              })}
            </div>

            <Card className="hidden md:block">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8 px-2"></TableHead>
                      <TableHead>Order ID</TableHead>
                      <TableHead>Pelanggan</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead className="text-right">Grand Total</TableHead>
                      <TableHead className="text-right w-[120px]">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingOrders ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="px-2"><Skeleton className="h-4 w-4" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[60px]" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                          <TableCell><Skeleton className="h-6 w-[80px] rounded-full" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                          <TableCell className="text-right"><Skeleton className="h-4 w-[100px] ml-auto" /></TableCell>
                          <TableCell className="text-right"><Skeleton className="h-8 w-[80px] ml-auto" /></TableCell>
                        </TableRow>
                      ))
                    ) : filteredOrders.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center">
                          <div className="flex flex-col items-center justify-center text-muted-foreground">
                            <ShoppingBag className="h-8 w-8 mb-2 opacity-50" />
                            <p>{orderSearch.trim() ? "Tidak ada order yang cocok dengan pencarian ini." : orderStatusFilter !== "all" ? "Tidak ada order dengan status ini." : "Belum ada order."}</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredOrders.map((order) => {
                        const isExpanded = expandedOrderIds.has(order.id);
                        const hasItems = (order.lineItems && order.lineItems.length > 0) || !!order.items;
                        return (
                          <React.Fragment key={order.id}>
                            <TableRow data-testid={`row-order-${order.id}`} className={isExpanded ? "border-b-0" : ""}>
                              <TableCell className="px-2">
                                {hasItems && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 text-muted-foreground"
                                    onClick={() => toggleOrderExpand(order.id)}
                                    aria-label={isExpanded ? "Tutup detail" : "Lihat detail item"}
                                    data-testid={`button-expand-order-${order.id}`}
                                  >
                                    <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                  </Button>
                                )}
                              </TableCell>
                              <TableCell className="font-medium">#ORD-{order.id.toString().padStart(4, '0')}</TableCell>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span>{order.customerName}</span>
                                  <span className="text-xs text-muted-foreground">{order.customerEmail}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={`capitalize ${getOrderStatusColor(order.status)}`}>{order.status}</Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground">{new Date(order.createdAt).toLocaleDateString()}</TableCell>
                              <TableCell className="text-right font-medium">
                                <div>{formatIDR(order.grandTotal)}</div>
                                {order.taxAmount > 0 && (
                                  <div className="text-xs text-muted-foreground">PPN: {formatIDR(order.taxAmount)}</div>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  <Button size="icon" variant="ghost" onClick={() => setPrintingOrder(order)} data-testid={`button-print-order-${order.id}`} aria-label="Cetak invoice">
                                    <Printer className="h-4 w-4" />
                                  </Button>
                                  <Button size="icon" variant="ghost" onClick={() => openEditOrder(order)} data-testid={`button-edit-order-${order.id}`} aria-label="Edit order">
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button size="icon" variant="ghost" onClick={() => setDeletingOrder(order)} data-testid={`button-delete-order-${order.id}`} aria-label="Hapus order" className="text-destructive hover:text-destructive">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                            {isExpanded && (
                              <TableRow className="bg-muted/30 hover:bg-muted/30">
                                <TableCell colSpan={7} className="py-0 px-6 pb-3">
                                  {order.lineItems && order.lineItems.length > 0 ? (
                                    <table className="w-full text-xs mt-2">
                                      <thead>
                                        <tr className="text-muted-foreground border-b border-border">
                                          <th className="text-left pb-1.5 font-medium">Item</th>
                                          <th className="text-center pb-1.5 font-medium w-14">Qty</th>
                                          <th className="text-right pb-1.5 font-medium w-28">Harga Satuan</th>
                                          <th className="text-right pb-1.5 font-medium w-28">Subtotal</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {order.lineItems.map((li, i) => (
                                          <tr key={i} className="border-b border-border/40 last:border-0">
                                            <td className="py-1.5">{li.name}</td>
                                            <td className="py-1.5 text-center text-muted-foreground">{li.qty}</td>
                                            <td className="py-1.5 text-right text-muted-foreground">{formatIDR(li.unitPrice)}</td>
                                            <td className="py-1.5 text-right font-medium">{formatIDR(li.qty * li.unitPrice)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  ) : order.items ? (
                                    <p className="text-xs text-muted-foreground whitespace-pre-wrap mt-2">{order.items}</p>
                                  ) : null}
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="md:hidden space-y-3">
              {isLoadingOrders ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i}><CardContent className="p-4 space-y-2">
                    <Skeleton className="h-5 w-1/3" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-1/2" />
                  </CardContent></Card>
                ))
              ) : filteredOrders.length === 0 ? (
                <Card><CardContent className="p-8 text-center">
                  <ShoppingBag className="h-8 w-8 mb-2 opacity-50 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{orderSearch.trim() ? "Tidak ada order yang cocok dengan pencarian ini." : orderStatusFilter !== "all" ? "Tidak ada order dengan status ini." : "Belum ada order."}</p>
                </CardContent></Card>
              ) : (
                filteredOrders.map((order) => {
                  const isExpanded = expandedOrderIds.has(order.id);
                  const hasItems = (order.lineItems && order.lineItems.length > 0) || !!order.items;
                  return (
                  <Card key={order.id} data-testid={`card-order-${order.id}`}><CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium font-mono text-sm">#ORD-{order.id.toString().padStart(4, '0')}</p>
                      <Badge variant="outline" className={`capitalize shrink-0 ${getOrderStatusColor(order.status)}`}>{order.status}</Badge>
                    </div>
                    <div>
                      <p className="text-sm font-medium truncate">{order.customerName}</p>
                      <p className="text-xs text-muted-foreground truncate">{order.customerEmail}</p>
                    </div>
                    <div className="flex justify-between items-end pt-1 border-t border-border">
                      <p className="text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleDateString()}</p>
                      <div className="text-right">
                        <p className="text-sm font-bold">{formatIDR(order.grandTotal)}</p>
                        {order.taxAmount > 0 && (
                          <p className="text-xs text-muted-foreground">PPN: {formatIDR(order.taxAmount)}</p>
                        )}
                      </div>
                    </div>
                    {hasItems && (
                      <button
                        type="button"
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground w-full"
                        onClick={() => toggleOrderExpand(order.id)}
                        data-testid={`button-expand-order-mobile-${order.id}`}
                      >
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        {isExpanded ? "Sembunyikan item" : "Lihat item pesanan"}
                      </button>
                    )}
                    {isExpanded && (
                      <div className="rounded-md bg-muted/50 p-2 text-xs">
                        {order.lineItems && order.lineItems.length > 0 ? (
                          <table className="w-full">
                            <thead>
                              <tr className="text-muted-foreground border-b border-border">
                                <th className="text-left pb-1 font-medium">Item</th>
                                <th className="text-center pb-1 font-medium w-10">Qty</th>
                                <th className="text-right pb-1 font-medium w-24">Subtotal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {order.lineItems.map((li, i) => (
                                <tr key={i} className="border-b border-border/40 last:border-0">
                                  <td className="py-1">{li.name}</td>
                                  <td className="py-1 text-center text-muted-foreground">{li.qty}</td>
                                  <td className="py-1 text-right font-medium">{formatIDR(li.qty * li.unitPrice)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : order.items ? (
                          <p className="text-muted-foreground whitespace-pre-wrap">{order.items}</p>
                        ) : null}
                      </div>
                    )}
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setPrintingOrder(order)} data-testid={`button-print-order-mobile-${order.id}`}>
                        <Printer className="h-3.5 w-3.5 mr-1.5" /> Cetak
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => openEditOrder(order)} data-testid={`button-edit-order-mobile-${order.id}`}>
                        <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 text-destructive hover:text-destructive" onClick={() => setDeletingOrder(order)} data-testid={`button-delete-order-mobile-${order.id}`}>
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Hapus
                      </Button>
                    </div>
                  </CardContent></Card>
                  );
                })
              )}
            </div>
          </TabsContent>

          {/* CATEGORIES TAB */}
          <TabsContent value="categories" className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div>
                <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Kategori Produk</h2>
                <p className="text-sm text-muted-foreground mt-0.5">Kelola daftar kategori yang tersedia untuk produk.</p>
              </div>
              <Dialog open={isCategoryDialogOpen} onOpenChange={(open) => { setIsCategoryDialogOpen(open); if (!open) setCreateCategoryName(""); }}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-category"><Plus className="mr-2 h-4 w-4" /> Tambah Kategori</Button>
                </DialogTrigger>
                <DialogContent>
                  <form onSubmit={handleCreateCategory}>
                    <DialogHeader>
                      <DialogTitle>Tambah Kategori Baru</DialogTitle>
                      <DialogDescription>Tambahkan kategori produk baru ke daftar.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label htmlFor="category-name">Nama Kategori</Label>
                        <Input id="category-name" value={createCategoryName} onChange={(e) => setCreateCategoryName(e.target.value)} required placeholder="cth: Elektronik" data-testid="input-category-name" />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="submit" disabled={createProductCategory.isPending || !createCategoryName.trim()} data-testid="button-submit-category">
                        {createProductCategory.isPending ? "Menyimpan..." : "Buat Kategori"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nama Kategori</TableHead>
                      <TableHead className="text-center w-[140px]">Jumlah Produk</TableHead>
                      <TableHead className="text-right w-[120px]">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingCategories ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-4 w-[160px]" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[60px] mx-auto" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[80px] ml-auto" /></TableCell>
                        </TableRow>
                      ))
                    ) : productCategories.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center py-10 text-muted-foreground">
                          Belum ada kategori. Tambahkan kategori pertama Anda.
                        </TableCell>
                      </TableRow>
                    ) : (
                      productCategories.map((cat) => (
                        <TableRow key={cat.id} data-testid={`row-category-${cat.id}`}>
                          <TableCell className="font-medium">{cat.name}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant={cat.productCount === 0 ? "outline" : "secondary"} className={cat.productCount === 0 ? "text-muted-foreground" : ""}>
                              {cat.productCount}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="icon" variant="ghost" onClick={() => { setEditingCategory(cat); setEditCategoryName(cat.name); }} data-testid={`button-edit-category-${cat.id}`} aria-label="Edit kategori">
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" onClick={() => setDeletingCategory(cat)} data-testid={`button-delete-category-${cat.id}`} aria-label="Hapus kategori" className="text-destructive hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* EDIT CATEGORY DIALOG */}
      <Dialog open={!!editingCategory} onOpenChange={(open) => { if (!open) { setEditingCategory(null); setEditCategoryName(""); } }}>
        <DialogContent>
          {editingCategory && (
            <form onSubmit={handleEditCategory}>
              <DialogHeader>
                <DialogTitle>Edit Kategori</DialogTitle>
                <DialogDescription>Ganti nama kategori "{editingCategory.name}".</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-category-name">Nama Kategori</Label>
                  <Input id="edit-category-name" value={editCategoryName} onChange={(e) => setEditCategoryName(e.target.value)} required data-testid="input-edit-category-name" />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingCategory(null)}>Batal</Button>
                <Button type="submit" disabled={updateProductCategory.isPending || !editCategoryName.trim()} data-testid="button-save-category">
                  {updateProductCategory.isPending ? "Menyimpan..." : "Simpan"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* DELETE CATEGORY CONFIRM */}
      <AlertDialog open={!!deletingCategory} onOpenChange={(open) => !open && setDeletingCategory(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Kategori?</AlertDialogTitle>
            <AlertDialogDescription>
              Kategori <strong>{deletingCategory?.name}</strong> akan dihapus permanen. Kategori yang masih digunakan produk tidak dapat dihapus — ubah kategori produk tersebut terlebih dahulu.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-category">Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDeleteCategory} disabled={deleteProductCategory.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-category">
              {deleteProductCategory.isPending ? "Menghapus..." : "Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* EDIT PRODUCT DIALOG */}
      <Dialog open={!!editingProduct} onOpenChange={(open) => !open && setEditingProduct(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg md:max-w-2xl max-h-[90vh] overflow-y-auto">
          {editingProduct && (
            <form onSubmit={handleEditProduct}>
              <DialogHeader>
                <DialogTitle>Edit Produk</DialogTitle>
                <DialogDescription>Perbarui detail produk.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2"><Label htmlFor="edit-name">Nama Produk</Label><Input id="edit-name" name="name" defaultValue={editingProduct.name} required data-testid="input-edit-product-name" /></div>
                <div className="grid gap-2"><Label htmlFor="edit-sku">SKU</Label><Input id="edit-sku" name="sku" defaultValue={editingProduct.sku} required data-testid="input-edit-product-sku" /></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-2"><Label htmlFor="edit-price">Harga (IDR)</Label><Input id="edit-price" name="price" type="number" min="0" defaultValue={editingProduct.price} required data-testid="input-edit-product-price" /></div>
                  <div className="grid gap-2"><Label htmlFor="edit-stock">Stok</Label><Input id="edit-stock" name="stock" type="number" min="0" defaultValue={editingProduct.stock} required data-testid="input-edit-product-stock" /></div>
                </div>
                <div className="grid gap-2">
                  <Label>Kategori <span className="text-muted-foreground text-xs">(pilih satu atau lebih)</span></Label>
                  <div className="border rounded-md p-3 max-h-40 overflow-y-auto space-y-2" data-testid="edit-product-categories">
                    {[...productCategories].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                      <div key={c.id} className={`flex items-center gap-2${c.productCount === 0 ? " opacity-50" : ""}`}>
                        <Checkbox
                          id={`edit-cat-${c.id}`}
                          checked={editProdCategories.includes(c.name)}
                          onCheckedChange={(checked) => {
                            setEditProdCategories((prev) =>
                              checked ? [...prev, c.name] : prev.filter((n) => n !== c.name)
                            );
                          }}
                          data-testid={`edit-cat-checkbox-${c.id}`}
                        />
                        <label htmlFor={`edit-cat-${c.id}`} className="text-sm cursor-pointer">{c.name}</label>
                        <span className="text-xs text-muted-foreground tabular-nums">({c.productCount ?? 0})</span>
                      </div>
                    ))}
                    {productCategories.length === 0 && (
                      <p className="text-sm text-muted-foreground">Belum ada kategori. Buat kategori terlebih dahulu.</p>
                    )}
                  </div>
                </div>
                <ProductImageField
                  imageUrl={editImageUrl}
                  isUploading={editImageUploader.isUploading}
                  onPickFile={(file) => editImageUploader.uploadFile(file)}
                  onRemove={() => setEditImageUrl(null)}
                  onSetUrl={(url) => setEditImageUrl(url)}
                  resolveImage={resolveImage}
                  idPrefix="edit"
                />
                <div className="grid gap-2">
                  <Label>Tarif Pajak Penjualan Default</Label>
                  <Select value={editProdSalesTaxId ? String(editProdSalesTaxId) : "none"} onValueChange={(v) => setEditProdSalesTaxId(v === "none" ? null : parseInt(v))} data-testid="select-edit-product-sales-tax">
                    <SelectTrigger><SelectValue placeholder="Tidak ada pajak default" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Tidak ada pajak default</SelectItem>
                      {saleTaxes.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Tarif Pajak Pembelian Default</Label>
                  <Select value={editProdPurchaseTaxId ? String(editProdPurchaseTaxId) : "none"} onValueChange={(v) => setEditProdPurchaseTaxId(v === "none" ? null : parseInt(v))} data-testid="select-edit-product-purchase-tax">
                    <SelectTrigger><SelectValue placeholder="Tidak ada pajak default" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Tidak ada pajak default</SelectItem>
                      {purchaseTaxes.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2 border rounded-md p-3 bg-muted/30">
                  <Label className="text-sm font-semibold">Berat &amp; Dimensi Pengiriman</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="grid gap-1">
                      <Label htmlFor="edit-weight" className="text-xs">Berat (kg)</Label>
                      <Input id="edit-weight" type="number" min="0" step="0.001" placeholder="0.000" value={editWeightKg} onChange={e => setEditWeightKg(e.target.value)} />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="edit-goods-type" className="text-xs">Jenis Barang</Label>
                      <Input id="edit-goods-type" placeholder="mis. Elektronik" value={editGoodsType} onChange={e => setEditGoodsType(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div className="grid gap-1">
                      <Label htmlFor="edit-length" className="text-xs">Panjang (cm)</Label>
                      <Input id="edit-length" type="number" min="0" step="0.01" placeholder="0" value={editLengthCm} onChange={e => setEditLengthCm(e.target.value)} />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="edit-width" className="text-xs">Lebar (cm)</Label>
                      <Input id="edit-width" type="number" min="0" step="0.01" placeholder="0" value={editWidthCm} onChange={e => setEditWidthCm(e.target.value)} />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="edit-height" className="text-xs">Tinggi (cm)</Label>
                      <Input id="edit-height" type="number" min="0" step="0.01" placeholder="0" value={editHeightCm} onChange={e => setEditHeightCm(e.target.value)} />
                    </div>
                  </div>
                  {editWeightKg && parseFloat(editWeightKg) > 0 && editLengthCm && editWidthCm && editHeightCm && (
                    <p className="text-xs text-muted-foreground">
                      Volume: {((parseFloat(editLengthCm)||0)*(parseFloat(editWidthCm)||0)*(parseFloat(editHeightCm)||0)/1000000).toFixed(4)} m³
                    </p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingProduct(null)}>Batal</Button>
                <Button type="submit" disabled={updateProduct.isPending || editImageUploader.isUploading || editProdCategories.length === 0} data-testid="button-save-product">
                  {updateProduct.isPending ? "Menyimpan..." : "Simpan Perubahan"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* EDIT ORDER DIALOG */}
      <Dialog open={!!editingOrder} onOpenChange={(open) => !open && setEditingOrder(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg md:max-w-2xl max-h-[90vh] overflow-y-auto">
          {editingOrder && (
            <form onSubmit={handleEditOrder}>
              <DialogHeader>
                <DialogTitle>Edit Order</DialogTitle>
                <DialogDescription>Perbarui detail order pelanggan.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2"><Label htmlFor="edit-customer-name">Nama Pelanggan</Label><Input id="edit-customer-name" name="customerName" defaultValue={editingOrder.customerName} required data-testid="input-edit-order-customer-name" /></div>
                <div className="grid gap-2"><Label htmlFor="edit-customer-email">Email Pelanggan</Label><Input id="edit-customer-email" name="customerEmail" type="email" defaultValue={editingOrder.customerEmail} required data-testid="input-edit-order-customer-email" /></div>
                <div className="grid gap-2"><Label htmlFor="edit-customer-phone">No. WhatsApp / HP <span className="text-muted-foreground font-normal text-xs">(opsional, untuk notifikasi)</span></Label><Input id="edit-customer-phone" name="customerPhone" type="tel" placeholder="628xxxxxxxxxx" defaultValue={editingOrder.customerPhone ?? ""} data-testid="input-edit-order-customer-phone" /></div>
                <div className="grid gap-1">
                  <Label>Item Pesanan</Label>
                  <div className="border rounded-md overflow-hidden overflow-x-auto">
                    <table className="w-full text-sm min-w-[320px]">
                      <thead className="bg-muted text-muted-foreground">
                        <tr>
                          <th className="text-left px-2 py-1.5 font-medium">Nama Item</th>
                          <th className="text-center px-2 py-1.5 font-medium w-16">Qty</th>
                          <th className="text-right px-2 py-1.5 font-medium w-28">Harga Satuan</th>
                          <th className="w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {editLineItems.map((li, idx) => (
                          <tr key={li.id} className="border-t">
                            <td className="px-2 py-1">
                              <ProductAutocomplete
                                value={li.name}
                                onChange={(name) => { setEditLineItemsTouched(true); setEditLineItems((prev) => prev.map((r) => r.id === li.id ? { ...r, name } : r)); }}
                                onSelect={(name, price) => { setEditLineItemsTouched(true); setEditLineItems((prev) => prev.map((r) => r.id === li.id ? { ...r, name, unitPrice: price } : r)); }}
                                products={products ?? []}
                                placeholder="Nama produk"
                                className="h-7 text-sm border-0 shadow-none px-0 focus-visible:ring-0"
                                data-testid={`input-edit-order-item-name-${idx}`}
                              />
                            </td>
                            <td className="px-2 py-1">
                              <Input
                                type="number"
                                min="1"
                                value={li.qty}
                                onChange={(e) => { setEditLineItemsTouched(true); setEditLineItems((prev) => prev.map((r) => r.id === li.id ? { ...r, qty: Math.max(1, Number(e.target.value) || 1) } : r)); }}
                                className="h-7 text-sm text-center border-0 shadow-none px-0 focus-visible:ring-0 w-14"
                                data-testid={`input-edit-order-item-qty-${idx}`}
                              />
                            </td>
                            <td className="px-2 py-1">
                              <Input
                                type="number"
                                min="0"
                                value={li.unitPrice || ""}
                                onChange={(e) => { setEditLineItemsTouched(true); setEditLineItems((prev) => prev.map((r) => r.id === li.id ? { ...r, unitPrice: Number(e.target.value) || 0 } : r)); }}
                                placeholder="0"
                                className="h-7 text-sm text-right border-0 shadow-none px-0 focus-visible:ring-0"
                                data-testid={`input-edit-order-item-price-${idx}`}
                              />
                            </td>
                            <td className="px-1 py-1 text-center">
                              {editLineItems.length > 1 && (
                                <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => { setEditLineItemsTouched(true); setEditLineItems((prev) => prev.filter((r) => r.id !== li.id)); }}>
                                  <X className="h-3 w-3" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="mt-1 w-full" onClick={() => { setEditLineItemsTouched(true); setEditLineItems((prev) => [...prev, newLineItem()]); }} data-testid="button-edit-add-line-item">
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Tambah Item
                  </Button>
                </div>
                <div className="grid gap-2">
                  <Label>Subtotal (IDR)</Label>
                  <Input
                    id="edit-total"
                    type="number"
                    value={editSubtotal}
                    readOnly={editLineItemsTouched}
                    onChange={(e) => !editLineItemsTouched && setEditSubtotal(Number(e.target.value) || 0)}
                    className={editLineItemsTouched ? "bg-muted text-muted-foreground cursor-not-allowed" : ""}
                    data-testid="input-edit-order-total"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="edit-tax-rate">Tarif PPN</Label>
                    <Select value={editTaxRateId} onValueChange={handleEditTaxRateChange} data-testid="select-edit-tax-rate">
                      <SelectTrigger id="edit-tax-rate" data-testid="select-trigger-edit-tax-rate"><SelectValue placeholder="Tidak ada PPN" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Tidak ada PPN</SelectItem>
                        {saleTaxes.map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>{t.name} ({Number(t.rate).toFixed(0)}%)</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-tax-amount">PPN (IDR)</Label>
                    <Input
                      id="edit-tax-amount"
                      type="number"
                      min="0"
                      value={editTaxAmount}
                      readOnly
                      className="bg-muted text-muted-foreground cursor-not-allowed"
                      data-testid="input-edit-order-tax"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-status">Status</Label>
                    <Select value={editOrderStatus} onValueChange={(v) => setEditOrderStatus(v as OrderStatus)}>
                      <SelectTrigger id="edit-status" data-testid="select-edit-order-status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ORDER_STATUSES.map(s => (
                          <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingOrder(null)}>Batal</Button>
                <Button type="submit" disabled={updateOrder.isPending} data-testid="button-save-order">
                  {updateOrder.isPending ? "Menyimpan..." : "Simpan Perubahan"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* DELETE PRODUCT CONFIRMATION */}
      <AlertDialog open={!!deletingProduct} onOpenChange={(open) => !open && setDeletingProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus produk ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Produk <strong>{deletingProduct?.name}</strong> akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-product">Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDeleteProduct} disabled={deleteProduct.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-product">
              {deleteProduct.isPending ? "Menghapus..." : "Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* DELETE ORDER CONFIRMATION */}
      <AlertDialog open={!!deletingOrder} onOpenChange={(open) => !open && setDeletingOrder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus order ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Order <strong>#ORD-{deletingOrder?.id.toString().padStart(4, '0')}</strong> dari {deletingOrder?.customerName} akan dihapus permanen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-order">Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDeleteOrder} disabled={deleteOrder.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-order">
              {deleteOrder.isPending ? "Menghapus..." : "Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* INVOICE PRINT DIALOG */}
      {printingOrder && (
        <OrderInvoiceDialog
          order={printingOrder}
          formatIDR={formatIDR}
          onClose={() => setPrintingOrder(null)}
        />
      )}
    </AppShell>
  );
}

interface OrderInvoiceDialogProps {
  order: Order;
  formatIDR: (v: number) => string;
  onClose: () => void;
}

function OrderInvoiceDialog({ order, formatIDR, onClose }: OrderInvoiceDialogProps) {
  const { data: settings } = useGetAccountingSettings();
  const companyName = settings?.companyName || 'BizPortal';
  const companyAddress = settings?.companyAddress ?? null;
  const companyNpwp = settings?.companyNpwp ?? null;
  const companyLogoUrl = settings?.companyLogoUrl ?? null;
  const logoSrc = companyLogoUrl
    ? (companyLogoUrl.startsWith('/objects/') ? `/api/storage${companyLogoUrl}` : companyLogoUrl)
    : null;

  const orderId = `#ORD-${order.id.toString().padStart(4, '0')}`;
  const date = new Date(order.createdAt).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const lineItems = order.lineItems ?? null;
  // SAP LOCK: ALL financial values from backend fields only.
  // FORBIDDEN: subtotal + tax, reduce(), any derived computation.
  // If grandTotal is missing from backend, show "—" (do NOT compute fallback).
  const subtotal = order.totalAmount;
  const tax = order.taxAmount ?? 0;
  const grand = order.grandTotal ?? null; // SAP LOCK — never compute from subtotal + tax
  assertSapSource("grandTotal", grand);
  // taxPct is display-only label; derived from backend taxAmount/totalAmount, not computed for posting
  const taxPct = order.taxAmount != null && order.totalAmount > 0
    ? Math.round((order.taxAmount / order.totalAmount) * 100)
    : null;

  const handlePrint = () => {
    window.print();
  };

  const printContent = (
    <div id="order-invoice-print-root" style={{ display: 'none' }}>
      <style>{`
        @media print {
          body > *:not(#order-invoice-print-root) { display: none !important; }
          #order-invoice-print-root { display: block !important; position: fixed; inset: 0; background: white; z-index: 99999; padding: 40px; box-sizing: border-box; }
        }
      `}</style>
      <div style={{ maxWidth: 600, margin: '0 auto', fontFamily: 'sans-serif', color: '#000' }}>
        <div style={{ borderBottom: '2px solid #000', paddingBottom: 16, marginBottom: 24, display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          {logoSrc && (
            <img src={logoSrc} alt="Logo" style={{ height: 56, width: 'auto', maxWidth: 140, objectFit: 'contain' }} />
          )}
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>INVOICE</h1>
            <p style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 600 }}>{companyName}</p>
            {companyAddress && <p style={{ margin: '2px 0 0', fontSize: 13, color: '#555', whiteSpace: 'pre-wrap' }}>{companyAddress}</p>}
            {companyNpwp && <p style={{ margin: '2px 0 0', fontSize: 13, color: '#555' }}>NPWP: {companyNpwp}</p>}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <p style={{ fontWeight: 600, margin: '0 0 4px' }}>Tagihan Kepada:</p>
            <p style={{ margin: 0 }}>{order.customerName}</p>
            <p style={{ margin: 0, color: '#555' }}>{order.customerEmail}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontWeight: 600, margin: '0 0 4px' }}>{orderId}</p>
            <p style={{ margin: 0, color: '#555' }}>{date}</p>
          </div>
        </div>
        {lineItems && lineItems.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #000' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px 6px 0', fontSize: 13 }}>Item</th>
                <th style={{ textAlign: 'center', padding: '6px 8px', fontSize: 13, width: 48 }}>Qty</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: 13, width: 120 }}>Harga Satuan</th>
                <th style={{ textAlign: 'right', padding: '6px 0 6px 8px', fontSize: 13, width: 120 }}>Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((li, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '6px 8px 6px 0', fontSize: 13 }}>{li.name}</td>
                  <td style={{ textAlign: 'center', padding: '6px 8px', fontSize: 13 }}>{li.qty}</td>
                  <td style={{ textAlign: 'right', padding: '6px 8px', fontSize: 13 }}>{formatIDR(li.unitPrice)}</td>
                  <td style={{ textAlign: 'right', padding: '6px 0 6px 8px', fontSize: 13 }}>{formatIDR(li.qty * li.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : order.items ? (
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontWeight: 600, margin: '0 0 8px' }}>Item:</p>
            <p style={{ margin: 0, color: '#333', whiteSpace: 'pre-wrap' }}>{order.items}</p>
          </div>
        ) : null}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
          <tbody>
            <tr>
              <td style={{ padding: '8px 0', borderTop: '1px solid #ddd' }}>Subtotal</td>
              <td style={{ padding: '8px 0', borderTop: '1px solid #ddd', textAlign: 'right' }}>{formatIDR(subtotal)}</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 0', borderTop: '1px solid #ddd' }}>PPN{taxPct != null ? ` ${taxPct}%` : ''}</td>
              <td style={{ padding: '8px 0', borderTop: '1px solid #ddd', textAlign: 'right' }}>{formatIDR(tax)}</td>
            </tr>
            <tr>
              <td style={{ padding: '12px 0', borderTop: '2px solid #000', fontWeight: 700, fontSize: 16 }}>Grand Total</td>
              {/* SAP LOCK: grand total from backend only — never computed */}
              <td style={{ padding: '12px 0', borderTop: '2px solid #000', textAlign: 'right', fontWeight: 700, fontSize: 16 }}>{grand != null ? formatIDR(grand) : '—'}</td>
            </tr>
          </tbody>
        </table>
        <p style={{ marginTop: 32, fontSize: 12, color: '#888', textAlign: 'center' }}>
          Terima kasih atas pembelian Anda.
        </p>
      </div>
    </div>
  );

  return (
    <>
      {createPortal(printContent, document.body)}

      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg" data-testid="dialog-invoice">
          <DialogHeader>
            <DialogTitle>Invoice {orderId}</DialogTitle>
            <DialogDescription>Pratinjau invoice dengan rincian PPN sebelum dicetak.</DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-white text-foreground p-6 space-y-4" data-testid="invoice-preview">
            <div className="border-b pb-3 flex items-start gap-3">
              {logoSrc && (
                <img
                  src={logoSrc}
                  alt="Logo Perusahaan"
                  className="h-12 w-auto max-w-[120px] object-contain"
                  data-testid="invoice-company-logo"
                />
              )}
              <div>
                <p className="font-bold text-base" data-testid="invoice-company-name">{companyName}</p>
                {companyAddress && <p className="text-xs text-muted-foreground whitespace-pre-wrap" data-testid="invoice-company-address">{companyAddress}</p>}
                {companyNpwp && <p className="text-xs text-muted-foreground" data-testid="invoice-company-npwp">NPWP: {companyNpwp}</p>}
              </div>
            </div>
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Tagihan Kepada</p>
                <p className="font-medium">{order.customerName}</p>
                <p className="text-sm text-muted-foreground">{order.customerEmail}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Tanggal</p>
                <p className="font-medium text-sm">{date}</p>
              </div>
            </div>

            {lineItems && lineItems.length > 0 ? (
              <div data-testid="invoice-line-items">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1.5 font-medium text-xs text-muted-foreground uppercase tracking-wide">Item</th>
                      <th className="text-center py-1.5 font-medium text-xs text-muted-foreground uppercase tracking-wide w-12">Qty</th>
                      <th className="text-right py-1.5 font-medium text-xs text-muted-foreground uppercase tracking-wide w-28">Harga Satuan</th>
                      <th className="text-right py-1.5 font-medium text-xs text-muted-foreground uppercase tracking-wide w-28">Jumlah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((li, i) => (
                      <tr key={i} className="border-b last:border-b-0">
                        <td className="py-1.5">{li.name}</td>
                        <td className="py-1.5 text-center">{li.qty}</td>
                        <td className="py-1.5 text-right">{formatIDR(li.unitPrice)}</td>
                        <td className="py-1.5 text-right font-medium">{formatIDR(li.qty * li.unitPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : order.items ? (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Item</p>
                <p className="text-sm">{order.items}</p>
              </div>
            ) : null}

            <div className="border-t pt-4 space-y-2">
              <div className="flex justify-between text-sm" data-testid="invoice-subtotal">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatIDR(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm" data-testid="invoice-tax">
                <span className="text-muted-foreground">PPN{taxPct != null ? ` ${taxPct}%` : ''}</span>
                <span>{formatIDR(tax)}</span>
              </div>
              <div className="flex justify-between font-bold text-base border-t pt-2" data-testid="invoice-grand-total">
                <span>Grand Total</span>
                {/* SAP LOCK: backend order.grandTotal only — never computed */}
                <span>{grand != null ? formatIDR(grand) : '—'}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} className="no-print">Tutup</Button>
            <Button onClick={handlePrint} className="no-print" data-testid="button-print-invoice">
              <Printer className="h-4 w-4 mr-2" /> Cetak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProductThumb({ src, alt, size = "sm" }: { src: string | null; alt: string; size?: "sm" | "md" }) {
  const dims = size === "md" ? "h-14 w-14" : "h-10 w-10";
  if (!src) {
    return (
      <div className={`${dims} rounded-md border border-dashed bg-muted flex items-center justify-center text-muted-foreground shrink-0`} aria-label="Belum ada gambar">
        <ImageIcon className="h-4 w-4 opacity-60" />
      </div>
    );
  }
  return <img src={src} alt={alt} className={`${dims} rounded-md object-cover border shrink-0`} loading="lazy" />;
}

interface ProductImageFieldProps {
  imageUrl: string | null;
  isUploading: boolean;
  onPickFile: (file: File) => void;
  onRemove: () => void;
  onSetUrl: (url: string) => void;
  resolveImage: (url?: string | null) => string | null;
  idPrefix: string;
}

function ProductImageField({ imageUrl, isUploading, onPickFile, onRemove, onSetUrl, resolveImage, idPrefix }: ProductImageFieldProps) {
  const inputId = `${idPrefix}-product-image-input`;
  const preview = resolveImage(imageUrl);
  const [showUrlInput, setShowUrlInput] = React.useState(false);
  const [urlValue, setUrlValue] = React.useState("");

  const handleConfirmUrl = () => {
    const trimmed = urlValue.trim();
    if (trimmed) {
      onSetUrl(trimmed);
      setUrlValue("");
      setShowUrlInput(false);
    }
  };

  return (
    <div className="grid gap-2">
      <Label>Foto Produk</Label>
      <div className="flex items-center gap-3">
        <ProductThumb src={preview} alt="Pratinjau produk" size="md" />
        <div className="flex-1 flex flex-wrap gap-2">
          <input
            id={inputId}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid={`input-${idPrefix}-product-image`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f);
              e.target.value = "";
            }}
          />
          <Button type="button" variant="outline" size="sm" disabled={isUploading} onClick={() => { setShowUrlInput(false); document.getElementById(inputId)?.click(); }} data-testid={`button-${idPrefix}-upload-image`}>
            {isUploading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ImagePlus className="h-4 w-4 mr-1.5" />}
            {isUploading ? "Mengunggah..." : imageUrl ? "Ganti Foto" : "Unggah Foto"}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={isUploading} onClick={() => setShowUrlInput((v) => !v)} data-testid={`button-${idPrefix}-url-image`}>
            <Link className="h-4 w-4 mr-1.5" />
            Gunakan Link
          </Button>
          {imageUrl && !isUploading && (
            <Button type="button" variant="ghost" size="sm" onClick={onRemove} className="text-muted-foreground hover:text-destructive" data-testid={`button-${idPrefix}-remove-image`}>
              <Trash2 className="h-4 w-4 mr-1.5" /> Hapus
            </Button>
          )}
        </div>
      </div>
      {showUrlInput && (
        <div className="flex gap-2 items-center mt-1">
          <Input
            type="url"
            placeholder="https://example.com/gambar.jpg"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleConfirmUrl(); } }}
            className="flex-1 h-8 text-sm"
            data-testid={`input-${idPrefix}-image-url`}
          />
          <Button type="button" size="sm" className="h-8 px-3" onClick={handleConfirmUrl} disabled={!urlValue.trim()}>
            <Check className="h-4 w-4" />
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setShowUrlInput(false); setUrlValue(""); }}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Format: JPG/PNG, maks 10MB. Atau tempel link URL gambar.</p>
    </div>
  );
}
