import { useMemo, useState } from "react";
import {
  Barcode,
  Calculator,
  Check,
  Minus,
  Plus,
  Printer,
  ReceiptText,
  Search,
  ShoppingCart,
  Sparkles,
  Trash2,
  WalletCards,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  color: string;
};

type CartItem = Product & {
  quantity: number;
};

const products: Product[] = [
  {
    id: "kopi-susu",
    sku: "8991001",
    name: "Kopi Susu Aren",
    category: "Minuman",
    price: 18000,
    stock: 42,
    color: "from-amber-500 to-orange-600",
  },
  {
    id: "teh-lemon",
    sku: "8991002",
    name: "Lemon Tea Segar",
    category: "Minuman",
    price: 14000,
    stock: 31,
    color: "from-lime-500 to-emerald-600",
  },
  {
    id: "nasi-goreng",
    sku: "8992001",
    name: "Nasi Goreng Spesial",
    category: "Makanan",
    price: 32000,
    stock: 18,
    color: "from-rose-500 to-red-600",
  },
  {
    id: "mie-ayam",
    sku: "8992002",
    name: "Mie Ayam Bakso",
    category: "Makanan",
    price: 28000,
    stock: 22,
    color: "from-yellow-500 to-amber-600",
  },
  {
    id: "croissant",
    sku: "8993001",
    name: "Butter Croissant",
    category: "Snack",
    price: 22000,
    stock: 16,
    color: "from-orange-400 to-yellow-600",
  },
  {
    id: "air-mineral",
    sku: "8994001",
    name: "Air Mineral 600ml",
    category: "Retail",
    price: 6000,
    stock: 80,
    color: "from-sky-500 to-cyan-600",
  },
  {
    id: "roti-bakar",
    sku: "8993002",
    name: "Roti Bakar Coklat",
    category: "Snack",
    price: 24000,
    stock: 25,
    color: "from-stone-500 to-neutral-700",
  },
  {
    id: "paket-hemat",
    sku: "8995001",
    name: "Paket Hemat Kasir",
    category: "Bundle",
    price: 45000,
    stock: 12,
    color: "from-violet-500 to-indigo-600",
  },
];

const quickTender = [50000, 100000, 150000, 200000];

function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function currentReceiptCode() {
  return `POS-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Math.floor(Math.random() * 900 + 100)}`;
}

export default function Home() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(5);
  const [cashReceived, setCashReceived] = useState(100000);
  const [lastReceipt, setLastReceipt] = useState(currentReceiptCode());

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return products;
    }

    return products.filter((product) => {
      const searchable = `${product.name} ${product.category} ${product.sku}`.toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [query]);

  const subtotal = cart.reduce((total, item) => total + item.price * item.quantity, 0);
  const discountAmount = Math.round((subtotal * discount) / 100);
  const tax = Math.round((subtotal - discountAmount) * 0.11);
  const total = subtotal - discountAmount + tax;
  const change = Math.max(cashReceived - total, 0);
  const itemCount = cart.reduce((totalItems, item) => totalItems + item.quantity, 0);

  const addToCart = (product: Product) => {
    setCart((currentCart) => {
      const existingItem = currentCart.find((item) => item.id === product.id);

      if (existingItem) {
        return currentCart.map((item) =>
          item.id === product.id ? { ...item, quantity: Math.min(item.quantity + 1, product.stock) } : item,
        );
      }

      return [...currentCart, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId: string, quantity: number) => {
    setCart((currentCart) =>
      currentCart
        .map((item) => (item.id === productId ? { ...item, quantity: Math.max(0, Math.min(quantity, item.stock)) } : item))
        .filter((item) => item.quantity > 0),
    );
  };

  const clearCart = () => {
    setCart([]);
    setCashReceived(100000);
  };

  const completePayment = () => {
    if (cart.length === 0) {
      toast({
        title: "Keranjang masih kosong",
        description: "Tambahkan produk sebelum memproses pembayaran.",
        variant: "destructive",
      });
      return;
    }

    if (cashReceived < total) {
      toast({
        title: "Nominal pembayaran kurang",
        description: `Kurang ${formatRupiah(total - cashReceived)} dari total belanja.`,
        variant: "destructive",
      });
      return;
    }

    const receiptCode = currentReceiptCode();
    setLastReceipt(receiptCode);
    setCart([]);
    setCashReceived(100000);
    toast({
      title: "Transaksi berhasil",
      description: `${receiptCode} selesai. Kembalian ${formatRupiah(change)}.`,
      className: "bg-primary text-primary-foreground border-primary",
    });
  };

  return (
    <main className="min-h-[100dvh] overflow-hidden bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_32%),linear-gradient(135deg,#020617_0%,#07111f_46%,#111827_100%)] px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-5 rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/30 backdrop-blur md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
              <ShoppingCart className="h-7 w-7" />
            </div>
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge className="border-primary/40 bg-primary/15 text-primary hover:bg-primary/20">Aplikasi POS Kasir</Badge>
                <Badge variant="secondary" className="bg-white/10 text-white hover:bg-white/15">
                  Shift Pagi
                </Badge>
              </div>
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">KasirPro Retail Checkout</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-300 md:text-base">
                Sistem kasir modern untuk input produk cepat, penghitungan pajak, diskon, pembayaran tunai,
                dan ringkasan struk real-time.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-xs text-slate-400">Produk</p>
              <p className="text-xl font-bold">{products.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-xs text-slate-400">Item</p>
              <p className="text-xl font-bold">{itemCount}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-xs text-slate-400">Struk</p>
              <p className="text-sm font-semibold">{lastReceipt.slice(-7)}</p>
            </div>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[1.45fr_0.95fr]">
          <div className="flex flex-col gap-6">
            <Card className="border-white/10 bg-white/[0.07] shadow-xl shadow-black/20 backdrop-blur">
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-2xl">
                      <Barcode className="h-6 w-6 text-primary" />
                      Katalog Produk
                    </CardTitle>
                    <CardDescription className="text-slate-300">
                      Cari nama, kategori, atau SKU lalu klik kartu produk untuk masuk keranjang.
                    </CardDescription>
                  </div>
                  <div className="relative w-full md:w-80">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Cari produk / SKU..."
                      className="border-white/10 bg-black/25 pl-9 text-white placeholder:text-slate-500"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addToCart(product)}
                      className="group overflow-hidden rounded-3xl border border-white/10 bg-black/20 p-4 text-left transition duration-300 hover:-translate-y-1 hover:border-primary/50 hover:bg-white/10 hover:shadow-xl hover:shadow-primary/10"
                    >
                      <div className={`mb-4 h-24 rounded-2xl bg-gradient-to-br ${product.color} p-4 shadow-lg`}>
                        <div className="flex h-full items-end justify-between text-white">
                          <Sparkles className="h-6 w-6 opacity-80" />
                          <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur">
                            {product.category}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-white">{product.name}</p>
                          <p className="mt-1 text-xs text-slate-400">SKU {product.sku}</p>
                        </div>
                        <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200">
                          {product.stock}
                        </Badge>
                      </div>
                      <div className="mt-4 flex items-center justify-between">
                        <p className="text-lg font-bold text-primary">{formatRupiah(product.price)}</p>
                        <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary group-hover:bg-primary group-hover:text-primary-foreground">
                          Tambah
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-3">
              <Card className="border-white/10 bg-white/[0.07] backdrop-blur">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Penjualan Hari Ini</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-primary">{formatRupiah(8240000)}</p>
                  <p className="text-sm text-slate-400">+18% dari kemarin</p>
                </CardContent>
              </Card>
              <Card className="border-white/10 bg-white/[0.07] backdrop-blur">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Transaksi</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">128</p>
                  <p className="text-sm text-slate-400">Rata-rata 64 ribu</p>
                </CardContent>
              </Card>
              <Card className="border-white/10 bg-white/[0.07] backdrop-blur">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Metode Favorit</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">Tunai</p>
                  <p className="text-sm text-slate-400">Siap integrasi QRIS</p>
                </CardContent>
              </Card>
            </div>
          </div>

          <aside className="xl:sticky xl:top-6 xl:self-start">
            <Card className="overflow-hidden border-white/10 bg-slate-950/85 shadow-2xl shadow-black/40 backdrop-blur-xl">
              <CardHeader className="border-b border-white/10 bg-white/[0.04]">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-2xl">
                      <ReceiptText className="h-6 w-6 text-primary" />
                      Keranjang
                    </CardTitle>
                    <CardDescription className="text-slate-300">Struk #{lastReceipt}</CardDescription>
                  </div>
                  <Button variant="ghost" size="icon" onClick={clearCart} className="text-slate-300 hover:text-white">
                    <Trash2 className="h-5 w-5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[330px] p-5">
                  {cart.length === 0 ? (
                    <div className="grid h-[280px] place-items-center rounded-3xl border border-dashed border-white/10 bg-white/[0.03] text-center">
                      <div>
                        <ShoppingCart className="mx-auto mb-3 h-10 w-10 text-slate-500" />
                        <p className="font-semibold text-slate-200">Belum ada item</p>
                        <p className="mt-1 text-sm text-slate-500">Klik produk untuk mulai transaksi.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {cart.map((item) => (
                        <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-white">{item.name}</p>
                              <p className="text-sm text-slate-400">{formatRupiah(item.price)} / item</p>
                            </div>
                            <p className="font-bold text-primary">{formatRupiah(item.price * item.quantity)}</p>
                          </div>
                          <div className="mt-3 flex items-center justify-between">
                            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 p-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-full"
                                onClick={() => updateQuantity(item.id, item.quantity - 1)}
                              >
                                <Minus className="h-4 w-4" />
                              </Button>
                              <span className="min-w-8 text-center font-semibold">{item.quantity}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-full"
                                onClick={() => updateQuantity(item.id, item.quantity + 1)}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                            <Badge variant="secondary" className="bg-white/10 text-slate-200">
                              Stok {item.stock}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>

                <div className="space-y-4 border-t border-white/10 p-5">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-2 text-sm text-slate-300">
                      Diskon (%)
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={discount}
                        onChange={(event) => setDiscount(Number(event.target.value))}
                        className="border-white/10 bg-black/25 text-white"
                      />
                    </label>
                    <label className="space-y-2 text-sm text-slate-300">
                      Tunai Diterima
                      <Input
                        type="number"
                        min="0"
                        value={cashReceived}
                        onChange={(event) => setCashReceived(Number(event.target.value))}
                        className="border-white/10 bg-black/25 text-white"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    {quickTender.map((amount) => (
                      <Button
                        key={amount}
                        type="button"
                        variant="secondary"
                        className="bg-white/10 text-xs hover:bg-white/15"
                        onClick={() => setCashReceived(amount)}
                      >
                        {amount / 1000}rb
                      </Button>
                    ))}
                  </div>

                  <Separator className="bg-white/10" />

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between text-slate-300">
                      <span>Subtotal</span>
                      <span>{formatRupiah(subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Diskon</span>
                      <span>-{formatRupiah(discountAmount)}</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>PPN 11%</span>
                      <span>{formatRupiah(tax)}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl bg-primary/15 p-4 text-lg font-bold text-primary">
                      <span>Total</span>
                      <span>{formatRupiah(total)}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-emerald-300">
                      <span>Kembalian</span>
                      <span>{formatRupiah(change)}</span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Button variant="secondary" className="bg-white/10 hover:bg-white/15">
                      <Printer className="mr-2 h-4 w-4" />
                      Cetak Struk
                    </Button>
                    <Button onClick={completePayment} className="font-bold text-primary-foreground shadow-lg shadow-primary/25">
                      <WalletCards className="mr-2 h-4 w-4" />
                      Bayar
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="mt-6 border-emerald-400/20 bg-emerald-400/10 backdrop-blur">
              <CardContent className="flex items-center gap-3 p-4 text-sm text-emerald-100">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-emerald-400/20">
                  <Check className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold">Mode kasir siap dipakai</p>
                  <p className="text-emerald-100/75">UI responsif, kalkulasi otomatis, dan alur checkout lengkap.</p>
                </div>
              </CardContent>
            </Card>
          </aside>
        </section>
      </div>

      <div className="pointer-events-none fixed bottom-8 left-8 hidden rounded-full border border-white/10 bg-white/10 p-4 shadow-2xl backdrop-blur lg:block">
        <Calculator className="h-7 w-7 text-primary" />
      </div>
    </main>
  );
}
