/**
 * PPJK Phase 8 — Officer assignment card
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { UserCircle, Users, UserCheck, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { id as idLocale } from "date-fns/locale";

interface Assignment {
  assignedOfficerName?: string | null;
  assignedOfficerId?: string | null;
  assignedTeam?: string | null;
  assignedSupervisor?: string | null;
  assignedAt?: string | null;
}

interface Props {
  orderId: number;
  assignment: Assignment;
}

export function PpjkAssignment({ orderId, assignment }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    assignedOfficerName: assignment.assignedOfficerName ?? "",
    assignedOfficerId: assignment.assignedOfficerId ?? "",
    assignedTeam: assignment.assignedTeam ?? "",
    assignedSupervisor: assignment.assignedSupervisor ?? "",
  });

  const f = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/ppjk/orders/${orderId}/assign`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error("Gagal assign");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Assignment disimpan");
      qc.invalidateQueries({ queryKey: ["ppjk-order", orderId] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hasAssignment = !!(assignment.assignedOfficerName || assignment.assignedTeam);

  return (
    <>
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-1.5">
          {hasAssignment ? (
            <div className="grid grid-cols-2 gap-2">
              {assignment.assignedOfficerName && (
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-blue-500 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Officer</p>
                    <p className="text-sm font-medium">{assignment.assignedOfficerName}</p>
                  </div>
                </div>
              )}
              {assignment.assignedTeam && (
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-500 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Team</p>
                    <p className="text-sm font-medium">{assignment.assignedTeam}</p>
                  </div>
                </div>
              )}
              {assignment.assignedSupervisor && (
                <div className="flex items-center gap-2">
                  <UserCircle className="w-4 h-4 text-teal-500 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Supervisor</p>
                    <p className="text-sm font-medium">{assignment.assignedSupervisor}</p>
                  </div>
                </div>
              )}
              {assignment.assignedAt && (
                <p className="text-xs text-muted-foreground col-span-2">
                  Assign: {formatDistanceToNow(new Date(assignment.assignedAt), { addSuffix: true, locale: idLocale })}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Belum ada officer yang ditugaskan</p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Pencil className="w-3.5 h-3.5 mr-1.5" />
          {hasAssignment ? "Edit" : "Assign"}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Assign Officer / Team</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Nama Officer</Label>
              <Input value={form.assignedOfficerName} onChange={(e) => f("assignedOfficerName", e.target.value)} placeholder="Nama petugas PPJK..." />
            </div>
            <div className="space-y-1.5">
              <Label>ID Officer</Label>
              <Input value={form.assignedOfficerId} onChange={(e) => f("assignedOfficerId", e.target.value)} placeholder="EMP-001" />
            </div>
            <div className="space-y-1.5">
              <Label>Tim</Label>
              <Input value={form.assignedTeam} onChange={(e) => f("assignedTeam", e.target.value)} placeholder="Tim Kepabeanan A" />
            </div>
            <div className="space-y-1.5">
              <Label>Supervisor</Label>
              <Input value={form.assignedSupervisor} onChange={(e) => f("assignedSupervisor", e.target.value)} placeholder="Nama supervisor..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
