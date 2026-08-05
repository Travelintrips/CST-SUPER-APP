import { useState, useEffect, useCallback } from "react";
import {
  ShoppingCart,
  Plus,
  Minus,
  ChevronLeft,
  CheckCircle,
  Utensils,
  MapPin,
  AlertCircle,
} from "lucide-react";

interface BranchInfo {
  id: number;
  name: string;
  address: string | null;
  company_name: string;
  company_logo: string | null;
}

interface Product {
  id: number;
  name: string;
  description: string | null;
  price: string;
  category: string;
  image_url: string | null;
}

interface CartItem {
  productId: number;
  name: string;
  price: number;
  qty: number;
}

type Step = "menu" | "cart" | "success";

function formatRp(n: number) {
  return "Rp\u00a0" + n.toLocaleString("id-ID");
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const branchId = params.get("branchId");
  const tableNum = params.get("table");

  const [branch, setBranch] = useState<BranchInfo | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [step, setStep] = useState<Step>("menu");
  const [activeCategory, setActiveCategory] = useState<string>("Semua");
  const [customerName, setCustomerName] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [ordering, setOrdering] = useState(false);
  const [orderResult, setOrderResult] = useState<{
    orderNumber: string;
    total: string;
  } | null>(null);

  useEffect(() => {
    if (!branchId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      fetch(`/api/qr-menu/${branchId}/info`).then((r) => r.json()),
      fetch(`/api/qr-menu/${branchId}/products`).then((r) => r.json()),
    ])
      .then(([info, prods]) => {
        if ((info as { error?: string }).error)
          throw new Error((info as { error: string }).error);
        setBranch(info as BranchInfo);
        setProducts(Array.isArray(prods) ? (prods as Product[]) : []);
      })
      .catch((e: unknown) =>
        setError((e as Error).message || "Gagal memuat menu"),
      )
      .finally(() => setLoading(false));
  }, [branchId]);

  const categories = [
    "Semua",
    ...Array.from(new Set(products.map((p) => p.category).filter(Boolean))),
  ];

  const filtered =
    activeCategory === "Semua"
      ? products
      : products.filter((p) => p.category === activeCategory);

  const getQty = (id: number) =>
    cart.find((c) => c.productId === id)?.qty ?? 0;

  const addToCart = useCallback((p: Product) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.productId === p.id);
      if (existing)
        return prev.map((c) =>
          c.productId === p.id ? { ...c, qty: c.qty + 1 } : c,
        );
      return [
        ...prev,
        { productId: p.id, name: p.name, price: Number(p.price), qty: 1 },
      ];
    });
  }, []);

  const removeFromCart = useCallback((id: number) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.productId === id);
      if (!existing) return prev;
      if (existing.qty <= 1) return prev.filter((c) => c.productId !== id);
      return prev.map((c) =>
        c.productId === id ? { ...c, qty: c.qty - 1 } : c,
      );
    });
  }, []);

  const incrementCart = useCallback((id: number) => {
    setCart((prev) =>
      prev.map((c) => (c.productId === id ? { ...c, qty: c.qty + 1 } : c)),
    );
  }, []);

  const totalItems = cart.reduce((s, c) => s + c.qty, 0);
  const totalPrice = cart.reduce((s, c) => s + c.price * c.qty, 0);

  const submitOrder = async () => {
    if (!branchId || cart.length === 0) return;
    setOrdering(true);
    try {
      const r = await fetch(`/api/qr-menu/${branchId}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((c) => ({ productId: c.productId, qty: c.qty })),
          tableNumber: tableNum ?? undefined,
          customerName: customerName || undefined,
          customerNote: customerNote || undefined,
        }),
      });
      const data = (await r.json()) as { error?: string; orderNumber?: string; total?: string };
      if (!r.ok) throw new Error(data.error ?? "Gagal mengirim pesanan");
      setOrderResult({ orderNumber: data.orderNumber!, total: data.total! });
      setStep("success");
    } catch (e: unknown) {
      alert((e as Error).message);
    } finally {
      setOrdering(false);
    }
  };

  const resetOrder = () => {
    setCart([]);
    setCustomerName("");
    setCustomerNote("");
    setStep("menu");
    setOrderResult(null);
  };

  // ── Invalid QR ───────────────────────────────────────────────────────────────
  if (!branchId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-3 text-red-400" size={52} />
          <p className="text-gray-700 font-semibold text-lg">QR code tidak valid</p>
          <p className="text-gray-400 text-sm mt-1">
            Silakan scan ulang QR code di meja Anda
          </p>
        </div>
      </div>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Memuat menu...</p>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-3 text-red-400" size={52} />
          <p className="text-gray-700 font-semibold">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-5 py-2 bg-orange-500 text-white rounded-full text-sm font-medium"
          >
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  // ── Success ──────────────────────────────────────────────────────────────────
  if (step === "success" && orderResult) {
    return (
      <div className="min-h-screen bg-orange-50 flex flex-col items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="text-green-500" size={44} />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-1">
            Pesanan Diterima!
          </h2>
          <p className="text-gray-500 text-sm mb-5">
            Pesanan Anda sedang diproses oleh kasir
          </p>

          <div className="bg-orange-50 rounded-2xl p-4 mb-5 text-left space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">No. Pesanan</span>
              <span className="font-mono font-bold text-orange-600 text-xs">
                {orderResult.orderNumber}
              </span>
            </div>
            {tableNum && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Meja</span>
                <span className="font-bold text-gray-700">{tableNum}</span>
              </div>
            )}
            <div className="flex justify-between text-sm border-t border-orange-100 pt-2">
              <span className="text-gray-600 font-medium">Total</span>
              <span className="font-bold text-gray-800">
                {formatRp(Number(orderResult.total))}
              </span>
            </div>
          </div>

          <p className="text-xs text-gray-400 mb-6">
            Mohon tunggu, kasir akan segera melayani Anda
          </p>

          <button
            onClick={resetOrder}
            className="w-full py-3.5 bg-orange-500 text-white rounded-2xl font-bold hover:bg-orange-600 transition-colors"
          >
            Pesan Lagi
          </button>
        </div>
      </div>
    );
  }

  // ── Cart ─────────────────────────────────────────────────────────────────────
  if (step === "cart") {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
        <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10 shadow-sm">
          <button
            onClick={() => setStep("menu")}
            className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft size={22} />
          </button>
          <div>
            <h1 className="font-bold text-gray-800">Pesanan Anda</h1>
            {tableNum && (
              <p className="text-xs text-orange-500 font-medium">
                Meja {tableNum}
              </p>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 pb-36 space-y-3">
          {cart.map((item) => (
            <div
              key={item.productId}
              className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 text-sm leading-tight">
                  {item.name}
                </p>
                <p className="text-orange-500 font-bold text-sm mt-0.5">
                  {formatRp(item.price)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => removeFromCart(item.productId)}
                  className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                >
                  <Minus size={14} className="text-gray-600" />
                </button>
                <span className="w-6 text-center font-bold text-sm">
                  {item.qty}
                </span>
                <button
                  onClick={() => incrementCart(item.productId)}
                  className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center hover:bg-orange-600 transition-colors"
                >
                  <Plus size={14} className="text-white" />
                </button>
              </div>
            </div>
          ))}

          <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
            <h3 className="font-semibold text-gray-700 text-sm">
              Informasi{" "}
              <span className="text-gray-400 font-normal">(opsional)</span>
            </h3>
            <input
              type="text"
              placeholder="Nama Anda"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
            <textarea
              placeholder="Catatan tambahan (tidak pedas, alergi, dll)"
              value={customerNote}
              onChange={(e) => setCustomerNote(e.target.value)}
              rows={2}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none"
            />
          </div>
        </div>

        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-100 p-4 z-20">
          <div className="flex justify-between items-center mb-3">
            <span className="text-gray-600 font-medium">Total</span>
            <span className="text-orange-500 font-bold text-xl">
              {formatRp(totalPrice)}
            </span>
          </div>
          <button
            onClick={submitOrder}
            disabled={ordering || cart.length === 0}
            className="w-full py-4 bg-orange-500 text-white rounded-2xl font-bold text-base hover:bg-orange-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {ordering ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Mengirim...
              </>
            ) : (
              "Kirim Pesanan ke Kasir"
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Menu (default) ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
      {/* Header */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-bold text-gray-800 text-lg leading-tight truncate">
                {branch?.name ?? "Menu"}
              </h1>
              {branch?.address && (
                <div className="flex items-center gap-1 mt-0.5">
                  <MapPin size={11} className="text-gray-400 shrink-0" />
                  <p className="text-xs text-gray-400 truncate">
                    {branch.address}
                  </p>
                </div>
              )}
            </div>
            {tableNum && (
              <div className="bg-orange-50 border border-orange-200 rounded-2xl px-3 py-1.5 text-center shrink-0">
                <p className="text-[10px] text-orange-400 font-semibold uppercase tracking-wide leading-none">
                  Meja
                </p>
                <p className="text-orange-600 font-black text-2xl leading-tight">
                  {tableNum}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Category filter */}
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto scrollbar-hide">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeCategory === cat
                  ? "bg-orange-500 text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Product grid */}
      <div className="flex-1 overflow-y-auto p-3 pb-28">
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Utensils className="mx-auto mb-3 text-gray-200" size={48} />
            <p className="text-gray-400 text-sm">Belum ada menu tersedia</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((product) => {
              const qty = getQty(product.id);
              return (
                <div
                  key={product.id}
                  className="bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col"
                >
                  {/* Image */}
                  <div className="aspect-square bg-gradient-to-br from-orange-50 to-amber-50 relative">
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Utensils size={32} className="text-orange-200" />
                      </div>
                    )}
                    {product.category && (
                      <span className="absolute top-2 left-2 bg-white/80 backdrop-blur-sm text-[10px] text-gray-600 px-2 py-0.5 rounded-full font-medium">
                        {product.category}
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-2.5 flex-1 flex flex-col">
                    <p className="text-sm font-semibold text-gray-800 leading-tight line-clamp-2 mb-1">
                      {product.name}
                    </p>
                    {product.description && (
                      <p className="text-xs text-gray-400 line-clamp-1 mb-1">
                        {product.description}
                      </p>
                    )}
                    <p className="text-orange-500 font-bold text-sm mt-auto mb-2">
                      {formatRp(Number(product.price))}
                    </p>

                    {qty === 0 ? (
                      <button
                        onClick={() => addToCart(product)}
                        className="w-full py-1.5 bg-orange-500 text-white rounded-xl text-sm font-semibold hover:bg-orange-600 transition-colors flex items-center justify-center gap-1"
                      >
                        <Plus size={14} /> Tambah
                      </button>
                    ) : (
                      <div className="flex items-center justify-between bg-orange-50 rounded-xl px-2 py-1">
                        <button
                          onClick={() => removeFromCart(product.id)}
                          className="w-7 h-7 rounded-full bg-white flex items-center justify-center shadow-sm"
                        >
                          <Minus size={13} className="text-orange-500" />
                        </button>
                        <span className="font-bold text-orange-600 text-sm">
                          {qty}
                        </span>
                        <button
                          onClick={() => addToCart(product)}
                          className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center shadow-sm"
                        >
                          <Plus size={13} className="text-white" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sticky cart bar */}
      {totalItems > 0 && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md p-4 z-20 pointer-events-none">
          <button
            onClick={() => setStep("cart")}
            className="w-full bg-orange-500 text-white rounded-2xl py-4 px-5 flex items-center justify-between shadow-xl hover:bg-orange-600 transition-colors pointer-events-auto"
          >
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <ShoppingCart size={20} />
                <span className="absolute -top-2 -right-2 w-4 h-4 bg-white text-orange-500 rounded-full text-[9px] font-black flex items-center justify-center leading-none">
                  {totalItems}
                </span>
              </div>
              <span className="text-sm font-semibold">{totalItems} item</span>
            </div>
            <span className="font-bold">{formatRp(totalPrice)} →</span>
          </button>
        </div>
      )}
    </div>
  );
}
