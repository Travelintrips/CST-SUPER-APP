import { useState, useEffect, useCallback } from "react";
import type { AuthUser } from "@workspace/api-client-react";

export type { AuthUser };

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth/user", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ user: AuthUser | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          setUser(data.user ?? null);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(() => {
    if (typeof window === "undefined") return;

    // Prefer Vite's BASE_URL (set at build time), then window.__BASE_PATH__, then "/"
    const base: string =
      (window as any).__BASE_PATH__ ||
      "/";

    const returnTo = encodeURIComponent(base);

    // Always use an absolute URL so the login + OIDC callback flow goes through
    // the exact same origin (port) as this page. Without this, window.open() with
    // a relative URL resolves through the Replit default external port which may
    // map to a different service (e.g. Customer Portal) instead of BizPortal.
    const origin = window.location.origin;
    const loginUrl = `${origin}/api/login?returnTo=${returnTo}`;

    const isInIframe = window !== window.top;
    if (isInIframe) {
      // When inside Replit's preview iframe, open login in a new tab to avoid
      // Replit's OIDC page being blocked by X-Frame-Options.
      const authWindow = window.open(loginUrl, "_blank", "noopener");
      if (authWindow) {
        // Poll until the session cookie is visible from this iframe, then reload.
        const poll = setInterval(() => {
          fetch("/api/auth/user", { credentials: "include" })
            .then((r) => r.json())
            .then((data: { user: AuthUser | null }) => {
              if (data.user) {
                clearInterval(poll);
                window.location.reload();
              }
            })
            .catch(() => {});
        }, 2000);
        setTimeout(() => clearInterval(poll), 5 * 60 * 1000);
      } else {
        // Pop-up was blocked — fall back to full navigation
        window.location.href = loginUrl;
      }
    } else {
      window.location.href = loginUrl;
    }
  }, []);

  const logout = useCallback(() => {
    if (typeof window === "undefined") return;
    const base: string = (window as any).__BASE_PATH__ || "/";
    window.location.href = `${window.location.origin}/api/logout?redirect=${encodeURIComponent(base)}`;
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
  };
}
