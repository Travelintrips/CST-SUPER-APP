import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

type Company = { id: number; name: string };

interface CompanySelectProps {
  value: string;
  onChange: (val: string) => void;
  label?: string;
  className?: string;
}

export function CompanySelect({ value, onChange, label = "Perusahaan", className }: CompanySelectProps) {
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["companies-list"],
    queryFn: () =>
      fetch("/api/companies/list", { credentials: "include" }).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Label className="text-xs text-slate-400">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="bg-slate-800 border-slate-700 text-white w-48">
          <SelectValue placeholder="Semua Perusahaan" />
        </SelectTrigger>
        <SelectContent className="bg-slate-800 border-slate-700">
          <SelectItem value="all" className="text-slate-300 focus:bg-slate-700 focus:text-white">
            Semua Perusahaan
          </SelectItem>
          {companies.map(c => (
            <SelectItem
              key={c.id}
              value={String(c.id)}
              className="text-slate-300 focus:bg-slate-700 focus:text-white"
            >
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
