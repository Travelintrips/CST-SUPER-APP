import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckSquare } from "lucide-react";

interface CompletionData {
  supplierId: number;
  supplierName: string;
  overall: number;
  breakdown: Record<string, { score: number; weight: number; fields?: { key: string; ok: boolean }[] }>;
  products: Array<{
    id: number;
    name: string;
    status: string;
    checks: {
      hasGallery: boolean;
      hasSpec: boolean;
      hasDescription: boolean;
      hasHsCode: boolean;
      hasDocument: boolean;
    };
  }>;
}

interface VendorCompletionScoreProps {
  vendorId: number;
}

const BREAKDOWN_LABELS: Record<string, string> = {
  companyProfile: "Company Profile",
  supplierData: "Supplier Data",
  gallery: "Gallery",
  specification: "Specification",
  documents: "Documents",
  hsCode: "HS Code",
  description: "Description",
};

export function VendorCompletionScore({ vendorId }: VendorCompletionScoreProps) {
  const { data, isLoading } = useQuery<CompletionData>({
    queryKey: ["vendor-completion", vendorId],
    queryFn: async () => {
      const r = await fetch(`/api/trading/suppliers/${vendorId}/completion`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat completion score");
      return r.json();
    },
    enabled: !!vendorId,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) return null;
  if (!data) return null;

  const { overall, breakdown } = data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <CheckSquare className="h-4 w-4 text-green-500" />
          Kelengkapan Data Vendor — {overall}%
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="w-full bg-slate-100 rounded-full h-2.5 mb-4">
          <div
            className="h-2.5 rounded-full transition-all duration-500"
            style={{
              width: `${overall}%`,
              background: overall >= 80 ? "#16a34a" : overall >= 50 ? "#d97706" : "#dc2626",
            }}
          />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {Object.entries(breakdown).map(([key, val]) => (
            <div key={key} className="text-xs">
              <div className="flex justify-between items-center mb-0.5">
                <span className="text-muted-foreground text-[11px]">{BREAKDOWN_LABELS[key] ?? key}</span>
                <span className="font-semibold tabular-nums text-[11px]">{val.score}%</span>
              </div>
              <div className="bg-slate-100 rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full"
                  style={{
                    width: `${val.score}%`,
                    background: val.score >= 80 ? "#16a34a" : val.score >= 50 ? "#d97706" : "#dc2626",
                  }}
                />
              </div>
              {val.weight && (
                <span className="text-muted-foreground/60 text-[10px]">bobot {val.weight}%</span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
