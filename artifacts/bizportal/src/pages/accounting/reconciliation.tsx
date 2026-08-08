import { useState, useMemo, useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  useListAccounts,
} from "@workspace/api-client-react";
import {
  ArrowLeft, CheckCircle2, Circle, GitMerge, Printer, Download,
  FileSpreadsheet, RefreshCw, AlertTriangle, XCircle, Info, Clock, Save,
  Sparkles, Link2,
} from "lucide-react";
import { exportXlsx, printWindow } from "@/lib/export";
import { Link } from "wouter";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

interface ReconCandidate {
  sourceType: string;
  sourceId: number;
  amount: number;
  grossAmount?: number;
  date: string;
  ref: string | null;
  label: string;
  paymentMethod: string | null;
  direction: "IN" | "OUT";
  score: number;
  reasons: string[];
  available: boolean;
}

interface ReconLine {
  id: number;
  entryId: number;
  accountId: number;
  description: string | null;
  debit: number;
  credit: number;
  entryNumber: string;
  entryDate: string;
  entrySource: string;
  journalId: number;
  ref: string | null;
  paymentMethod: string | null;
  status: "unreconciled" | "suggested" | "reconciled";
  match: {
    sourceType: string | null;
    sourceId: number | null;
    method: string | null;
    score: number | null;
    details: { reasons?: string[] } | null;
    reconciledAt: string | null;
  } | null;
  suggestion: ReconCandidate | null;
  candidateCount: number;
}

// ─── Tab: Manual ──────────────────────────────────────────────────────────────

function ManualTab() {
  const { data: accounts } = useListAccounts();
  const [accountId, setAccountId] = useState<number | undefined>();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [bankBalance, setBankBalance] = useState("");
  const [rows, setRows] = useState<ReconLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [autoMatching, setAutoMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadReconciliation() {
    if (!accountId) {
      setRows([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ accountId: String(accountId) });
      if (from) query.set("from", new Date(from).toISOString());
      if (to) query.set("to", new Date(`${to}T23:59:59`).toISOString());
      const response = await fetch(`/api/accounting/reconciliation/lines?${query}`, { credentials: "include" });
      const json = await response.json() as ReconLine[] | { message?: string };
      if (!response.ok) throw new Error("message" in json ? json.message : "Gagal memuat rekonsiliasi");
      setRows(json as ReconLine[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat rekonsiliasi");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadReconciliation();
  }, [accountId, from, to]);

  async function saveStatus(line: ReconLine, status: "unreconciled" | "reconciled", candidate?: ReconCandidate | null) {
    setSavingId(line.id);
    setError(null);
    try {
      const response = await fetch("/api/accounting/reconciliation/status", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineId: line.id,
          status,
          sourceType: candidate?.sourceType ?? null,
          sourceId: candidate?.sourceId ?? null,
          matchMethod: candidate ? "manual-confirm" : "manual",
          matchScore: candidate?.score ?? null,
          matchDetails: candidate ? { reasons: candidate.reasons, amount: candidate.amount, date: candidate.date, ref: candidate.ref } : {},
        }),
      });
      const json = await response.json() as { message?: string };
      if (!response.ok) throw new Error(json.message ?? "Gagal menyimpan status");
      await loadReconciliation();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan status");
    } finally {
      setSavingId(null);
    }
  }

  async function runAutoMatch() {
    if (!accountId) return;
    setAutoMatching(true);
    setError(null);
    try {
      const query = new URLSearchParams({ accountId: String(accountId) });
      if (from) query.set("from", new Date(from).toISOString());
      if (to) query.set("to", new Date(`${to}T23:59:59`).toISOString());
      const response = await fetch(`/api/accounting/reconciliation/auto-match?${query}`, {
        method: "POST",
        credentials: "include",
      });
      const json = await response.json() as { message?: string; matched?: number };
      if (!response.ok) throw new Error(json.message ?? "Gagal menjalankan pencocokan otomatis");
      await loadReconciliation();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menjalankan pencocokan otomatis");
    } finally {
      setAutoMatching(false);
    }
  }

  const reconciledRows = rows.filter((r) => r.status === "reconciled");
  const unreconciledRows = rows.filter((r) => r.status !== "reconciled");
  const reconciled = new Set(reconciledRows.map((r) => r.id));
  const totalDebit = rows.reduce((s, l) => s + l.debit, 0);
  const totalCredit = rows.reduce((s, l) => s + l.credit, 0);
  const bookBalance = totalDebit - totalCredit;
  const bankBal = parseFloat(bankBalance.replace(/[^0-9.-]/g, "")) || 0;
  const difference = bankBal - bookBalance;
  const selectedAccount = accounts?.find((a) => a.id === accountId);

  function handleExportXlsx() {
    exportXlsx("Rekonsiliasi_" + (selectedAccount?.code ?? ""),
      ["No. Entry", "Tanggal", "Sumber", "Referensi", "Deskripsi", "Debit", "Kredit", "Status"],
      rows.map((l) => [l.entryNumber, new Date(l.entryDate).toLocaleDateString("id-ID"), l.entrySource, l.ref ?? "", l.description ?? "", l.debit || "", l.credit || "", l.status]));
  }
  function handlePrint() {
    printWindow(`Rekonsiliasi — ${selectedAccount?.code ?? ""} ${selectedAccount?.name ?? ""}`,
      ["No. Entry", "Tanggal", "Sumber", "Referensi", "Deskripsi", "Debit", "Kredit", "Status"],
      rows.map((l) => [l.entryNumber, new Date(l.entryDate).toLocaleDateString("id-ID"), l.entrySource, l.ref ?? "", l.description ?? "", l.debit || "", l.credit || "", l.status]),
      [5, 6]);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={handlePrint} disabled={rows.length === 0}><Printer className="h-4 w-4 mr-1.5" />Print Preview</Button>
        <Button variant="outline" size="sm" onClick={handleExportXlsx} disabled={rows.length === 0}><Download className="h-4 w-4 mr-1.5" />Export XLSX</Button>
      </div>
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <Label>Akun Bank / Kas</Label>
              <Select value={accountId ? String(accountId) : ""} onValueChange={(v) => setAccountId(parseInt(v))}>
                <SelectTrigger><SelectValue placeholder="Pilih akun..." /></SelectTrigger>
                <SelectContent>
                  {(accounts ?? []).filter((a) => a.isActive && a.type === "asset").map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Dari</Label><DatePicker value={from} onChange={setFrom} /></div>
            <div><Label>Sampai</Label><DatePicker value={to} onChange={setTo} /></div>
          </div>
        </CardContent>
      </Card>

      {accountId && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Saldo Buku</CardTitle></CardHeader>
              <CardContent className="pt-0"><p className="text-2xl font-bold font-mono">{idr(bookBalance)}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Saldo Bank (Manual)</CardTitle></CardHeader>
              <CardContent className="pt-0"><Input type="number" placeholder="0" value={bankBalance} onChange={(e) => setBankBalance(e.target.value)} className="font-mono text-lg h-9" /></CardContent>
            </Card>
            <Card className={difference === 0 && bankBalance ? "border-emerald-500" : difference !== 0 && bankBalance ? "border-rose-500" : ""}>
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Selisih</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <p className={`text-2xl font-bold font-mono ${difference === 0 && bankBalance ? "text-emerald-600" : difference !== 0 && bankBalance ? "text-rose-600" : ""}`}>{bankBalance ? idr(difference) : "—"}</p>
                {bankBalance && difference === 0 && <p className="text-xs text-emerald-600 font-medium mt-0.5">✓ Balance</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Progress</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <p className="text-2xl font-bold">{reconciled.size}<span className="text-base text-muted-foreground font-normal">/{rows.length}</span></p>
                <p className="text-xs text-muted-foreground">transaksi direkonsiliasi</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold">Mutasi Buku Besar</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={runAutoMatch} disabled={autoMatching || isLoading || rows.length === 0}>
                    <Sparkles className={`h-4 w-4 mr-1.5 ${autoMatching ? "animate-pulse" : ""}`} />
                    {autoMatching ? "Mencocokkan..." : "Cocokkan Otomatis"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => Promise.all(reconciledRows.map((row) => saveStatus(row, "unreconciled")))} disabled={savingId !== null || reconciledRows.length === 0}>Reset</Button>
                </div>
              </div>
              {error && <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><XCircle className="h-4 w-4 mt-0.5 shrink-0" />{error}</div>}
              {isLoading ? <p className="text-muted-foreground text-sm py-8 text-center">Memuat data...</p>
                : rows.length === 0 ? <p className="text-muted-foreground text-sm py-8 text-center">Tidak ada mutasi untuk akun dan periode ini</p>
                : (
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10"></TableHead>
                          <TableHead>No. Entry</TableHead><TableHead>Tanggal</TableHead><TableHead>Sumber</TableHead>
                          <TableHead>Referensi</TableHead><TableHead>Deskripsi</TableHead>
                          <TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Kredit</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((line) => {
                           const isRec = line.status === "reconciled";
                           const candidate = line.suggestion;
                           const isSaving = savingId === line.id;
                          return (
                            <TableRow key={line.id} className={isRec ? "bg-emerald-50/60" : ""}>
                              <TableCell>
                                 <button
                                   onClick={() => void saveStatus(line, isRec ? "unreconciled" : "reconciled", isRec ? null : candidate)}
                                   disabled={isSaving}
                                   title={candidate ? `Cocokkan dengan ${candidate.label}` : "Tandai manual"}
                                   className="text-muted-foreground hover:text-emerald-600 transition-colors disabled:opacity-50"
                                 >
                                  {isRec ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5" />}
                                </button>
                              </TableCell>
                              <TableCell className="font-mono text-xs font-semibold">{line.entryNumber}</TableCell>
                              <TableCell className="text-xs whitespace-nowrap">{new Date(line.entryDate).toLocaleDateString("id-ID")}</TableCell>
                              <TableCell><Badge variant="secondary" className="text-xs">{line.entrySource}</Badge></TableCell>
                               <TableCell className="text-xs text-muted-foreground">{line.ref ?? "—"}{line.paymentMethod && <span className="ml-1 text-[10px] uppercase text-violet-600">({line.paymentMethod})</span>}</TableCell>
                              <TableCell className="text-xs max-w-[180px] truncate">{line.description ?? "—"}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{line.debit > 0 && <span className="text-blue-700 font-semibold">{idr(line.debit)}</span>}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{line.credit > 0 && <span className="text-emerald-700 font-semibold">{idr(line.credit)}</span>}</TableCell>
                               <TableCell className="min-w-[240px]">
                                 {isRec
                                   ? <div className="space-y-1">
                                       <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">✓ Reconciled</Badge>
                                       {line.match?.sourceType && <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Link2 className="h-3 w-3" />{line.match.sourceType} #{line.match.sourceId} · {line.match.method}</p>}
                                     </div>
                                   : candidate
                                   ? <div className="space-y-1">
                                       <div className="flex items-center gap-1.5">
                                         <Badge variant="outline" className="border-blue-200 text-blue-700 text-xs">Saran {candidate.score}%</Badge>
                                         <span className="text-[10px] text-muted-foreground">{line.candidateCount} kandidat</span>
                                       </div>
                                       <p className="text-[10px] text-muted-foreground truncate max-w-[220px]" title={candidate.label}>{candidate.label}</p>
                                       <p className="text-[10px] text-blue-700">{candidate.reasons.join(" · ")}</p>
                                     </div>
                                   : <Badge variant="outline" className="text-xs text-muted-foreground">Belum cocok</Badge>}
                               </TableCell>
                            </TableRow>
                          );
                        })}
                        <TableRow className="font-bold bg-muted/30 border-t-2">
                          <TableCell colSpan={6} className="text-right text-sm">Total</TableCell>
                          <TableCell className="text-right font-mono text-blue-700">{idr(totalDebit)}</TableCell>
                          <TableCell className="text-right font-mono text-emerald-700">{idr(totalCredit)}</TableCell>
                          <TableCell></TableCell>
                        </TableRow>
                        {reconciledRows.length > 0 && (
                          <TableRow className="bg-emerald-50/40">
                            <TableCell colSpan={6} className="text-right text-xs text-emerald-700 font-medium">Reconciled ({reconciledRows.length})</TableCell>
                            <TableCell className="text-right font-mono text-xs text-emerald-700">{idr(reconciledRows.reduce((s, l) => s + l.debit, 0))}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-emerald-700">{idr(reconciledRows.reduce((s, l) => s + l.credit, 0))}</TableCell>
                            <TableCell></TableCell>
                          </TableRow>
                        )}
                        {unreconciledRows.length > 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-right text-xs text-muted-foreground font-medium">Unreconciled ({unreconciledRows.length})</TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">{idr(unreconciledRows.reduce((s, l) => s + l.debit, 0))}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">{idr(unreconciledRows.reduce((s, l) => s + l.credit, 0))}</TableCell>
                            <TableCell></TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
            </CardContent>
          </Card>
        </>
      )}
      {!accountId && (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <GitMerge className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Pilih akun untuk memulai rekonsiliasi</p>
            <p className="text-sm mt-1">Pilih akun Bank/Kas di atas, lalu atur periode</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface RekonResult {
  id: number; entryNumber: string; entryDate: string;
  debit: number; credit: number; description: string | null;
  key: string; status: string; gsRow: number | null;
}
interface RekonResponse {
  ok: boolean;
  summary: { total: number; matched: number; duplicate: number; notFound: number; updated: number };
  results: RekonResult[];
}
interface ScheduleConfig {
  enabled: boolean; spreadsheetId: string; sheetName: string;
  colKey: number; colStatus: number; startRow: number; hourWib: number;
  lastRunDate?: string;
}

// Konversi huruf kolom GSheet → 0-index (A=0, B=1, F=5, dst)
function colLetterToIdx(col: string): number {
  const s = col.trim().toUpperCase();
  if (/^\d+$/.test(s)) return Number(s);
  let idx = 0;
  for (const ch of s) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1;
}

// ─── Schedule Card ────────────────────────────────────────────────────────────

function ScheduleCard({ spreadsheetId, sheetName, colKey, colStatus, startRow }: {
  spreadsheetId: string; sheetName: string; colKey: string; colStatus: string; startRow: string;
}) {
  const [cfg, setCfg] = useState<ScheduleConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [hourWib, setHourWib] = useState("2");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/accounting/rekon-schedule", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        const c = j.config as ScheduleConfig | null;
        if (c) { setCfg(c); setEnabled(c.enabled); setHourWib(String(c.hourWib ?? 2)); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false);
    try {
      const res = await fetch("/api/accounting/rekon-schedule", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          spreadsheetId: spreadsheetId.trim() || (cfg?.spreadsheetId ?? ""),
          sheetName: sheetName.trim() || (cfg?.sheetName ?? "Mutasi"),
          colKey: colLetterToIdx(colKey) ?? (cfg?.colKey ?? 5),
          colStatus: colLetterToIdx(colStatus) ?? (cfg?.colStatus ?? 6),
          startRow: Number(startRow) || (cfg?.startRow ?? 2),
          hourWib: Number(hourWib),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Gagal menyimpan");
      setCfg(json.config as ScheduleConfig);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  }

  if (loading) return null;

  const wibLabel = (h: number) => `${String(h).padStart(2, "0")}:00 WIB`;

  return (
    <Card className="border-dashed border-2">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Jadwal Rekonsiliasi Otomatis
          {cfg?.lastRunDate && (
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              Terakhir run: {cfg.lastRunDate}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onCheckedChange={setEnabled} id="rekon-enabled" />
          <Label htmlFor="rekon-enabled" className="font-normal cursor-pointer">
            {enabled ? "Aktif — rekonsiliasi berjalan otomatis setiap hari" : "Nonaktif"}
          </Label>
        </div>

        {enabled && (
          <div className="flex items-end gap-4">
            <div className="w-52">
              <Label>Jam Eksekusi (WIB)</Label>
              <Select value={hourWib} onValueChange={setHourWib}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>{wibLabel(i)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground pb-2 leading-relaxed">
              Setiap hari pukul <strong>{wibLabel(Number(hourWib))}</strong> sistem akan otomatis mencocokkan entry DB 30 hari terakhir dengan Google Sheet dan mengirim ringkasan via WhatsApp ke admin.
            </p>
          </div>
        )}

        {error && (
          <p className="text-xs text-red-600 flex gap-1.5">
            <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Menyimpan...</> : <><Save className="h-3.5 w-3.5 mr-1.5" />Simpan Jadwal</>}
          </Button>
          {saved && <span className="text-xs text-emerald-600 font-medium">✓ Tersimpan</span>}
        </div>

        <p className="text-xs text-muted-foreground">
          Konfigurasi spreadsheet mengikuti form di atas. Pastikan form sudah diisi sebelum mengaktifkan jadwal.
        </p>
      </CardContent>
    </Card>
  );
}

// Konversi 0-index → huruf kolom (0=A, 5=F, dst)
function colIdxToLetter(n: number): string {
  let s = ""; let col = n;
  while (col >= 0) { s = String.fromCharCode((col % 26) + 65) + s; col = Math.floor(col / 26) - 1; }
  return s;
}

// ─── Tab: Google Sheets ───────────────────────────────────────────────────────

function GSheetTab() {
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [sheetName, setSheetName] = useState("Mutasi");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [colKey, setColKey] = useState("F");
  const [colStatus, setColStatus] = useState("G");
  const [startRow, setStartRow] = useState("2");
  const [loading, setLoading] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RekonResponse | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [saEmail, setSaEmail] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/accounting/gsheet/sa-email", { credentials: "include" }).then((r) => r.json()).catch(() => ({})),
      fetch("/api/accounting/rekon-schedule", { credentials: "include" }).then((r) => r.json()).catch(() => ({})),
    ]).then(([emailData, scheduleData]) => {
      if ((emailData as { email?: string }).email) setSaEmail((emailData as { email: string }).email);
      const cfg = (scheduleData as { config?: ScheduleConfig }).config;
      if (cfg?.spreadsheetId) setSpreadsheetId(cfg.spreadsheetId);
      if (cfg?.sheetName) setSheetName(cfg.sheetName);
      if (cfg?.colKey != null) setColKey(colIdxToLetter(cfg.colKey));
      if (cfg?.colStatus != null) setColStatus(colIdxToLetter(cfg.colStatus));
      if (cfg?.startRow != null) setStartRow(String(cfg.startRow));
      setConfigLoaded(true);
    });
  }, []);

  async function handleSaveConfig() {
    setSavingConfig(true); setConfigSaved(false);
    try {
      const existRes = await fetch("/api/accounting/rekon-schedule", { credentials: "include" });
      const existJson = await existRes.json() as { config?: ScheduleConfig };
      const existing = existJson.config;
      await fetch("/api/accounting/rekon-schedule", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: existing?.enabled ?? false,
          spreadsheetId: spreadsheetId.trim(),
          sheetName: sheetName.trim() || "Mutasi",
          colKey: colLetterToIdx(colKey),
          colStatus: colLetterToIdx(colStatus),
          startRow: Number(startRow) || 2,
          hourWib: existing?.hourWib ?? 2,
        }),
      });
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 3000);
    } catch { /* non-fatal */ } finally { setSavingConfig(false); }
  }

  async function handleRun() {
    if (!spreadsheetId.trim()) { setError("Spreadsheet ID wajib diisi"); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch("/api/accounting/rekonsiliasi-gsheet", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheetId: spreadsheetId.trim(),
          sheetName: sheetName.trim() || "Mutasi",
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          colKey: colLetterToIdx(colKey), colStatus: colLetterToIdx(colStatus), startRow: Number(startRow),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Gagal menjalankan rekonsiliasi");
      setResult(json as RekonResponse);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

  function handleExport() {
    if (!result) return;
    exportXlsx("Rekonsiliasi_GSheet",
      ["No. Entry", "Tanggal", "Debit", "Kredit", "Deskripsi", "Unique Key", "Status GSheet", "Baris GS"],
      result.results.map((r) => [r.entryNumber, new Date(r.entryDate).toLocaleDateString("id-ID"), r.debit || "", r.credit || "", r.description ?? "", r.key, r.status, r.gsRow ?? ""]));
  }

  const displayedRows = useMemo(() => {
    if (!result) return [];
    if (filterStatus === "cocok") return result.results.filter((r) => r.status.startsWith("✅"));
    if (filterStatus === "duplikat") return result.results.filter((r) => r.status.startsWith("⚠️"));
    if (filterStatus === "tidak_ada") return result.results.filter((r) => r.status.startsWith("❌"));
    return result.results;
  }, [result, filterStatus]);

  return (
    <div className="space-y-4">
      {/* Panduan */}
      <Card className="border-blue-200 bg-blue-50/40">
        <CardContent className="p-4">
          <div className="flex gap-2 text-blue-800">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="text-sm space-y-1">
              <p className="font-semibold">Panduan pengaturan kolom Google Sheet:</p>
              <p>Buat kolom <strong>Unique Key</strong> di sheet dengan formula GSheet, lalu set kolom tersebut di field "Kolom Unique Key" di bawah (misal: kolom F → isi <strong>F</strong>).</p>
              <p>Format Unique Key yang dihasilkan BizPortal: <code className="bg-blue-100 px-1 rounded text-xs">yyyymmdd_jumlah_IN/OUT</code></p>
              <p>Contoh formula di GSheet: <code className="bg-blue-100 px-1 rounded text-xs">=TEXT(A2,"yyyymmdd")&amp;"_"&amp;IF(C2&gt;0,C2,D2)&amp;"_"&amp;IF(C2&gt;0,"IN","OUT")</code> — di mana C=Debit, D=Kredit</p>
              {saEmail && (
                <p className="mt-2 pt-2 border-t border-blue-200">
                  <strong>Sebelum mulai:</strong> Share spreadsheet ke email Service Account berikut sebagai <strong>Editor</strong>:{" "}
                  <code className="bg-blue-100 px-1.5 py-0.5 rounded text-xs font-mono select-all">{saEmail}</code>
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />Konfigurasi Rekonsiliasi
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Spreadsheet ID <span className="text-red-500">*</span></Label>
              <Input placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms" value={spreadsheetId} onChange={(e) => setSpreadsheetId(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Dari URL: docs.google.com/spreadsheets/d/<strong>ID_INI</strong>/edit</p>
            </div>
            <div>
              <Label>Nama Sheet / Tab</Label>
              <Input placeholder="Mutasi" value={sheetName} onChange={(e) => setSheetName(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><Label>Dari Tanggal</Label><DatePicker value={dateFrom} onChange={setDateFrom} /></div>
            <div><Label>Sampai Tanggal</Label><DatePicker value={dateTo} onChange={setDateTo} /></div>
            <div>
              <Label>Kolom Unique Key</Label>
              <Input placeholder="F" value={colKey} onChange={(e) => setColKey(e.target.value)} className="uppercase" />
              <p className="text-xs text-muted-foreground mt-1">Huruf kolom, misal: E, F, G</p>
            </div>
            <div>
              <Label>Kolom Status (diisi otomatis)</Label>
              <Input placeholder="G" value={colStatus} onChange={(e) => setColStatus(e.target.value)} className="uppercase" />
              <p className="text-xs text-muted-foreground mt-1">Kolom yang akan ditulis hasilnya</p>
            </div>
          </div>
          <div className="flex items-end gap-4">
            <div className="w-40">
              <Label>Baris Data Mulai</Label>
              <Input type="number" min={1} value={startRow} onChange={(e) => setStartRow(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Skip baris header</p>
            </div>
            <div className="flex-1 flex items-center justify-end gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={handleSaveConfig} disabled={savingConfig || !spreadsheetId.trim()} className="gap-1.5">
                {savingConfig ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Menyimpan...</> : <><Save className="h-3.5 w-3.5" />Simpan Konfigurasi</>}
              </Button>
              {configSaved && <span className="text-xs text-emerald-600 font-medium">✓ Tersimpan</span>}
              {result && <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-1.5" />Export XLSX</Button>}
              <Button onClick={handleRun} disabled={loading} className="min-w-44">
                {loading
                  ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Memproses...</>
                  : <><FileSpreadsheet className="h-4 w-4 mr-2" />Jalankan Rekonsiliasi</>}
              </Button>
            </div>
          </div>
          {configLoaded && !spreadsheetId && (
            <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Belum ada konfigurasi tersimpan. Isi Spreadsheet ID lalu klik Simpan Konfigurasi.</p>
          )}
          {error && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm flex gap-2">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />{error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Jadwal otomatis */}
      <ScheduleCard
        spreadsheetId={spreadsheetId}
        sheetName={sheetName}
        colKey={colKey}
        colStatus={colStatus}
        startRow={startRow}
      />

      {/* Hasil */}
      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Entry</CardTitle></CardHeader>
              <CardContent className="pt-0"><p className="text-2xl font-bold">{result.summary.total}</p></CardContent>
            </Card>
            <Card className="border-emerald-300">
              <CardHeader className="pb-2"><CardTitle className="text-xs text-emerald-700 font-medium uppercase tracking-wide flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Cocok</CardTitle></CardHeader>
              <CardContent className="pt-0"><p className="text-2xl font-bold text-emerald-700">{result.summary.matched}</p></CardContent>
            </Card>
            <Card className="border-amber-300">
              <CardHeader className="pb-2"><CardTitle className="text-xs text-amber-700 font-medium uppercase tracking-wide flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Duplikat</CardTitle></CardHeader>
              <CardContent className="pt-0"><p className="text-2xl font-bold text-amber-700">{result.summary.duplicate}</p></CardContent>
            </Card>
            <Card className="border-red-300">
              <CardHeader className="pb-2"><CardTitle className="text-xs text-red-700 font-medium uppercase tracking-wide flex items-center gap-1"><XCircle className="h-3.5 w-3.5" />Tidak Ditemukan</CardTitle></CardHeader>
              <CardContent className="pt-0"><p className="text-2xl font-bold text-red-700">{result.summary.notFound}</p></CardContent>
            </Card>
          </div>
          <p className="text-xs text-muted-foreground text-right">{result.summary.updated} baris diperbarui di Google Sheet</p>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold">Hasil Rekonsiliasi</p>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua ({result.results.length})</SelectItem>
                    <SelectItem value="cocok">✅ Cocok ({result.summary.matched})</SelectItem>
                    <SelectItem value="duplikat">⚠️ Duplikat ({result.summary.duplicate})</SelectItem>
                    <SelectItem value="tidak_ada">❌ Tidak Ada ({result.summary.notFound})</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No. Entry</TableHead><TableHead>Tanggal</TableHead>
                      <TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Kredit</TableHead>
                      <TableHead>Deskripsi</TableHead><TableHead>Unique Key</TableHead>
                      <TableHead>Status</TableHead><TableHead className="text-right">Baris GS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedRows.length === 0
                      ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Tidak ada data</TableCell></TableRow>
                      : displayedRows.map((r) => {
                          const isCocok = r.status.startsWith("✅");
                          const isDuplikat = r.status.startsWith("⚠️");
                          return (
                            <TableRow key={r.id} className={isCocok ? "bg-emerald-50/40" : isDuplikat ? "bg-amber-50/40" : "bg-red-50/30"}>
                              <TableCell className="font-mono text-xs font-semibold">{r.entryNumber || "—"}</TableCell>
                              <TableCell className="text-xs whitespace-nowrap">{new Date(r.entryDate).toLocaleDateString("id-ID")}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{r.debit > 0 && <span className="text-blue-700 font-semibold">{idr(r.debit)}</span>}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{r.credit > 0 && <span className="text-emerald-700 font-semibold">{idr(r.credit)}</span>}</TableCell>
                              <TableCell className="text-xs max-w-[160px] truncate text-muted-foreground">{r.description ?? "—"}</TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">{r.key}</TableCell>
                              <TableCell>
                                {isCocok
                                  ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs whitespace-nowrap">✅ Cocok</Badge>
                                  : isDuplikat
                                  ? <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs whitespace-nowrap">⚠️ Duplikat</Badge>
                                  : <Badge className="bg-red-100 text-red-700 border-red-200 text-xs whitespace-nowrap">❌ Tidak Ada</Badge>}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs text-muted-foreground">{r.gsRow ?? "—"}</TableCell>
                            </TableRow>
                          );
                        })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ReconciliationPage() {
  const [activeTab, setActiveTab] = useState<"manual" | "gsheet">("manual");
  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-3">
          <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><GitMerge className="h-6 w-6" />Rekonsiliasi Bank</h1>
            <p className="text-sm text-muted-foreground">Cocokkan mutasi buku besar dengan laporan bank</p>
          </div>
        </div>

        <div className="flex gap-1 border-b">
          {(["manual", "gsheet"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {tab === "manual" ? <><GitMerge className="h-4 w-4" />Manual</> : <><FileSpreadsheet className="h-4 w-4" />Google Sheets</>}
            </button>
          ))}
        </div>

        {activeTab === "manual" ? <ManualTab /> : <GSheetTab />}
      </div>
    </AppShell>
  );
}
