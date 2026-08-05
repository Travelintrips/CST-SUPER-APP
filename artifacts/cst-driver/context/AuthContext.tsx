import React, { createContext, useContext, useState, useEffect } from 'react';
import { storage } from '@/services/storage';
import { api } from '@/services/api';
import { Driver } from '@/types';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  driver: Driver | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  isLoading: true,
  driver: null,
  token: null,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const savedToken = await storage.getToken();
      if (savedToken) {
        const me = await api.getMe(savedToken);
        setToken(savedToken);
        setDriver(mapApiDriver(me));
        setIsAuthenticated(true);
      }
    } catch {
      await storage.clearAll();
    } finally {
      setIsLoading(false);
    }
  }

  async function login(email: string, password: string) {
    const data = await api.login(email, password);
    const { token: newToken, driver: apiDriver } = data as { token: string; driver: Record<string, unknown> };
    await storage.setToken(newToken);
    setToken(newToken);
    setDriver(mapApiDriver(apiDriver));
    setIsAuthenticated(true);
  }

  async function logout() {
    await storage.clearAll();
    setToken(null);
    setDriver(null);
    setIsAuthenticated(false);
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, driver, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

function mapApiDriver(d: Record<string, unknown>): Driver {
  return {
    id: String(d.id ?? ''),
    name: String(d.name ?? ''),
    phone: String(d.phone ?? ''),
    email: String(d.email ?? ''),
    licenseNumber: String(d.licenseNumber ?? ''),
    truckPlate: String(d.vehiclePlate ?? ''),
    vehicleType: String(d.vehicleType ?? ''),
    totalDeliveries: Number(d.totalDeliveries ?? 0),
    rating: Number(d.rating ?? 5.0),
  };
}

export const useAuth = () => useContext(AuthContext);
