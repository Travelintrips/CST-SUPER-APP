import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, ShoppingCart, Truck, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { LanguageSelector } from "@/components/layout/LanguageSelector";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";

export default function WelcomePage() {
  const { logout } = useSupabaseAuth();
  const { t } = useLanguage();

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4 text-foreground relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />

      <div className="max-w-4xl w-full space-y-8 relative z-10">
        <div className="absolute top-4 right-4 w-52">
          <LanguageSelector />
        </div>

        <div className="text-center space-y-4">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg mb-4">
            <Building2 size={32} />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">{t.welcome.title}</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            {t.welcome.subtitle}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-12">
          <Card className="bg-card border-border shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <ShoppingCart className="h-8 w-8 text-primary mb-2" />
              <CardTitle>{t.welcome.ecommerce}</CardTitle>
              <CardDescription className="text-muted-foreground">{t.welcome.ecommerceDesc}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{t.welcome.ecommerceDetail}</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <img src="/images/logo.png" alt="CST" className="h-8 w-auto object-contain mb-2" />
              <CardTitle>{t.welcome.trading}</CardTitle>
              <CardDescription className="text-muted-foreground">{t.welcome.tradingDesc}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{t.welcome.tradingDetail}</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <Truck className="h-8 w-8 text-primary mb-2" />
              <CardTitle>{t.welcome.logistics}</CardTitle>
              <CardDescription className="text-muted-foreground">{t.welcome.logisticsDesc}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{t.welcome.logisticsDetail}</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <Calculator className="h-8 w-8 text-primary mb-2" />
              <CardTitle>{t.welcome.pos}</CardTitle>
              <CardDescription className="text-muted-foreground">{t.welcome.posDesc}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{t.welcome.posDetail}</p>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-center pt-8">
          <Button
            variant="outline"
            onClick={() => logout()}
            className="min-w-[200px] border-border text-foreground hover:bg-accent"
          >
            {t.welcome.signOut}
          </Button>
        </div>
      </div>
    </div>
  );
}
