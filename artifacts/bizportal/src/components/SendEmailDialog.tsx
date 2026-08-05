import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Mail, Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";

interface SendEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docId: number;
  docNumber: string;
  docTitle: string;
  defaultTo?: string;
  module: "sales" | "purchase";
}

export function SendEmailDialog({ open, onOpenChange, docId, docNumber, docTitle, defaultTo = "", module }: SendEmailDialogProps) {
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(`${docTitle} ${docNumber}`);
  const [body, setBody] = useState(`Yth. Bapak/Ibu,\n\nBersama email ini kami lampirkan ${docTitle} ${docNumber}.\n\nMohon konfirmasi penerimaan email ini.\n\nHormat kami,\nBizPortal`);
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!to.trim()) { toast.error("Masukkan alamat email tujuan"); return; }

    setLoading(true);
    try {
      const resp = await fetch(`/api/${module}/documents/${docId}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: to.trim(), subject: subject.trim(), body: body.trim() }),
      });
      const json = await resp.json() as { message?: string };
      if (!resp.ok) throw new Error(json.message ?? `Error ${resp.status}`);
      toast.success(`Email berhasil dikirim ke ${to.trim()}`);
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Gagal mengirim email");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Kirim via Email
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5 shrink-0" />
            Lampiran: <span className="font-medium text-foreground">{docNumber}.pdf</span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email-to">Kepada</Label>
            <Input
              id="email-to"
              type="email"
              placeholder="email@contoh.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email-subject">Subjek</Label>
            <Input
              id="email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email-body">Isi Email</Label>
            <Textarea
              id="email-body"
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Batal</Button>
          <Button onClick={handleSend} disabled={loading}>
            {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Mengirim...</> : <><Mail className="h-4 w-4 mr-2" />Kirim Email</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
