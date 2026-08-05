import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, Ship } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageSelector } from "@/components/layout/LanguageSelector";
import { useLanguage } from "@/contexts/LanguageContext";

export function Navbar() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    setIsAdmin(Boolean(localStorage.getItem("logistic_admin_auth")));
  }, []);

  const BASE_NAV_LINKS = [
    { label: t("nav.home"),    path: "/" },
    { label: t("nav.booking"), path: "/book" },
    { label: t("nav.track"),   path: "/track" },
  ];
  const ADMIN_LINK = { label: t("nav.admin"), path: "/admin" };
  const NAV_LINKS = isAdmin ? [...BASE_NAV_LINKS, ADMIN_LINK] : BASE_NAV_LINKS;

  function isActive(path: string) {
    if (path === "/") return location === "/";
    return location === path || location.startsWith(`${path}/`);
  }

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur-md transition-all duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <img
              src={`${import.meta.env.BASE_URL}logocst_nobg.png`}
              alt="B2B Marketplace and Logistic"
              className="h-9 w-auto object-contain"
              onError={(e) => {
                const img = e.currentTarget as HTMLImageElement;
                img.style.display = "none";
                const fallback = img.nextElementSibling as HTMLElement | null;
                if (fallback) fallback.style.display = "flex";
              }}
            />
            <div
              className="hidden h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"
              aria-hidden="true"
            >
              <Ship className="h-5 w-5" />
            </div>
            <span className="font-bold text-sm text-foreground tracking-wide">
              PT. Cahaya Sejati Teknologi
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.path}
                href={link.path}
                className={`px-3 py-2 text-sm font-medium rounded-md transition-colors duration-200 ${
                  isActive(link.path)
                    ? "bg-primary/8 text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right section */}
          <div className="hidden md:flex items-center gap-2 border-l border-border pl-4">
            <LanguageSelector />
            <Link href="/book">
              <Button size="sm" className="ml-1">
                {t("nav.startBooking")}
              </Button>
            </Link>
          </div>

          {/* Mobile hamburger */}
          <div className="flex md:hidden items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden border-t border-border bg-background">
          <div className="space-y-1 px-4 py-3">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.path}
                href={link.path}
                onClick={() => setOpen(false)}
              >
                <div
                  className={`block rounded-md px-3 py-2.5 text-sm font-medium cursor-pointer transition-colors ${
                    isActive(link.path)
                      ? "bg-primary/8 text-primary font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {link.label}
                </div>
              </Link>
            ))}
            <div className="py-1 border-t border-border mt-1 pt-2">
              <LanguageSelector />
            </div>
            <div className="pt-2 border-t border-border mt-2">
              <Link href="/book" onClick={() => setOpen(false)}>
                <Button className="w-full" size="sm">
                  {t("nav.startBooking")}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
