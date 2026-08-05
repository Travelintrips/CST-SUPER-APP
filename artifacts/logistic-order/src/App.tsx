import { useEffect } from "react";
import { useLanguage } from "@/contexts/LanguageContext";

const ROUTE_MAP: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^\/admin\/orders\/(.+)$/, (m) => `/logistic-admin/orders/${m[1]}`],
  [/^\/admin(\/.*)?$/, () => `/logistic-admin`],
  [/^\/order-success$/, () => `/logistic-order-success`],
  [/^\/track$/, () => `/track`],
  [/^\/book$/, () => `/book`],
  [/^\//, () => `/book`],
];

function getRedirectTarget(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const fullPath = window.location.pathname;
  const localPath = fullPath.startsWith(base) ? fullPath.slice(base.length) || "/" : "/";

  for (const [pattern, builder] of ROUTE_MAP) {
    const match = localPath.match(pattern);
    if (match) return builder(match);
  }
  return "/book";
}

export default function App() {
  const { t } = useLanguage();

  useEffect(() => {
    const target = getRedirectTarget();
    const search = window.location.search;
    window.location.replace(target + search);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-muted-foreground">{t("app.redirecting")}</p>
      </div>
    </div>
  );
}
