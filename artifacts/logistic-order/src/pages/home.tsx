import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/SectionTitle";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Ship,
  Plane,
  Package,
  Truck,
  FileCheck,
  Warehouse,
  Shield,
  ArrowRight,
  Globe,
  Clock,
  Award,
} from "lucide-react";

export default function HomePage() {
  const [, setLocation] = useLocation();
  const { t } = useLanguage();

  const SERVICES = [
    { icon: Plane,     labelKey: "home.svc.airFreight",        descKey: "home.svc.airFreight.desc" },
    { icon: Ship,      labelKey: "home.svc.seaFreight",        descKey: "home.svc.seaFreight.desc" },
    { icon: FileCheck, labelKey: "home.svc.customsClearance",  descKey: "home.svc.customsClearance.desc" },
    { icon: Truck,     labelKey: "home.svc.trucking",          descKey: "home.svc.trucking.desc" },
    { icon: Warehouse, labelKey: "home.svc.warehousing",       descKey: "home.svc.warehousing.desc" },
    { icon: Shield,    labelKey: "home.svc.insurance",         descKey: "home.svc.insurance.desc" },
  ];

  const FLOW_STEPS = [
    { step: "01", titleKey: "home.flow.step1.title", descKey: "home.flow.step1.desc" },
    { step: "02", titleKey: "home.flow.step2.title", descKey: "home.flow.step2.desc" },
    { step: "03", titleKey: "home.flow.step3.title", descKey: "home.flow.step3.desc" },
    { step: "04", titleKey: "home.flow.step4.title", descKey: "home.flow.step4.desc" },
  ];

  const STATS = [
    { icon: Globe,   labelKey: "home.stats.countries" },
    { icon: Package, labelKey: "home.stats.shipments" },
    { icon: Clock,   labelKey: "home.stats.support" },
    { icon: Award,   labelKey: "home.stats.certified" },
  ];

  return (
    <div className="bg-background">
      {/* Hero */}
      <section className="bg-primary text-primary-foreground">
        <div className="max-w-7xl mx-auto px-6 py-20 md:py-28">
          <div className="max-w-3xl">
            <Badge className="mb-6 bg-primary/20 text-primary-foreground border-0 text-xs font-semibold tracking-wider uppercase">
              {t("home.hero.badge")}
            </Badge>
            <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-6">
              {t("home.hero.title1")}<br />
              {t("home.hero.title2")}
            </h1>
            <p className="text-lg text-primary-foreground/70 mb-8 leading-relaxed">
              {t("home.hero.subtitle")}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                size="lg"
                className="bg-primary-foreground text-primary hover:bg-primary-foreground/90 font-semibold"
                onClick={() => setLocation("/book")}
              >
                {t("home.hero.startBooking")} <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/10"
                onClick={() => setLocation("/track")}
              >
                {t("home.hero.trackOrder")}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          {STATS.map(({ icon: Icon, labelKey }) => (
            <div key={labelKey} className="flex items-center gap-3">
              <Icon className="w-5 h-5 text-primary flex-shrink-0" />
              <span className="text-sm font-medium text-foreground">
                {t(labelKey)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* How it Works */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <div className="mb-10">
          <SectionTitle
            title={t("home.howItWorks.title")}
            subtitle={t("home.howItWorks.subtitle")}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {FLOW_STEPS.map(({ step, titleKey, descKey }, idx) => (
            <div key={step} className="relative">
              {idx < FLOW_STEPS.length - 1 && (
                <div
                  className="hidden md:block absolute top-5 left-full w-full h-px bg-border z-0"
                  style={{ width: "calc(100% - 2rem)", left: "calc(100% - 1rem)" }}
                />
              )}
              <div className="relative z-10 flex flex-col gap-3">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center">
                  {step}
                </div>
                <div>
                  <h3 className="font-semibold text-foreground text-sm mb-1">
                    {t(titleKey)}
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t(descKey)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Services */}
      <section className="bg-muted/30 border-y border-border">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="mb-10">
            <SectionTitle
              title={t("home.services.title")}
              subtitle={t("home.services.subtitle")}
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {SERVICES.map(({ icon: Icon, labelKey, descKey }) => (
              <div
                key={labelKey}
                className="bg-card border border-border rounded-lg p-5 hover:shadow-md transition-shadow"
              >
                <Icon className="w-6 h-6 text-primary mb-3" />
                <h3 className="font-semibold text-foreground text-sm mb-1">
                  {t(labelKey)}
                </h3>
                <p className="text-xs text-muted-foreground">{t(descKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-6 py-16 text-center">
        <div className="bg-primary rounded-2xl p-10 text-primary-foreground">
          <h2 className="text-2xl font-bold mb-3">{t("home.cta.title")}</h2>
          <p className="text-primary-foreground/70 mb-6 text-sm">
            {t("home.cta.subtitle")}
          </p>
          <Button
            size="lg"
            className="bg-primary-foreground text-primary hover:bg-primary-foreground/90 font-semibold"
            onClick={() => setLocation("/book")}
          >
            {t("home.cta.btn")} <ArrowRight className="ml-2 w-4 h-4" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Ship className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {t("home.footer.system")}
            </span>
          </div>
          <div className="flex gap-4 text-sm text-muted-foreground">
            <button onClick={() => setLocation("/book")} className="hover:text-foreground transition-colors">
              {t("home.footer.book")}
            </button>
            <button onClick={() => setLocation("/track")} className="hover:text-foreground transition-colors">
              {t("home.footer.track")}
            </button>
            <button onClick={() => setLocation("/admin")} className="hover:text-foreground transition-colors">
              {t("home.footer.admin")}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
