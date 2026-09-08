import { useState, useEffect } from "react";

export interface CartItem {
  cartId: string;
  category: string;
  serviceName: string;
  calculatorType: string;
  inputData: Record<string, unknown>;
  calculationResult: Record<string, unknown>;
  subtotal: number;
}

const CART_KEY = "logistic_cart";

export function useCart() {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const stored = localStorage.getItem(CART_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  }, [items]);

  function addItem(item: Omit<CartItem, "cartId">) {
    setItems((prev) => [...prev, { ...item, cartId: crypto.randomUUID() }]);
  }

  function removeItem(cartId: string) {
    setItems((prev) => prev.filter((i) => i.cartId !== cartId));
  }

  function updateItem(cartId: string, updates: Partial<Omit<CartItem, "cartId">>) {
    setItems((prev) =>
      prev.map((i) => (i.cartId === cartId ? { ...i, ...updates } : i))
    );
  }

  function clearCart() {
    setItems([]);
  }

  const hasFreightService = items.some((i) =>
    ["air_freight", "sea_fcl", "sea_lcl"].includes(i.calculatorType)
  );
  const taxRate = 0.11;
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const tax = Math.round(subtotal * taxRate * 100) / 100;
  const grandTotal = subtotal + tax;

  return { items, addItem, removeItem, updateItem, clearCart, subtotal, tax, grandTotal, taxRate, hasFreightService };
}
