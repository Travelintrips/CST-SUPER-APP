import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, Plus, RefreshCw, CheckCircle, Clock, AlertTriangle, Edit } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { format } from "date-fns";
import { id } from "date-fns/locale";

const DEPARTMENTS = ["Sales", "Operations", "Warehouse", "Customs", "Finance", "Customer Service", "Management"];
const TASK_TYPES = ["follow_up", "document_check", "approval", "coordination", "pickup_arrange", "delivery_confirm", "invoice", "payment_follow", "complaint", "other"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const STATUSES = ["open", "in_progress", "completed", "cancelled"];

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-gray-100 text-gray-600",
  normal: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-500",
};

async function fetchTasks(params: Record<string, string>) {
  const q = new URLSearchParams(params);
  const r = await fetch(`/api/internal-tasks?${q}`);
  if (!r.ok) throw new Error("Failed");
  return r.json();
}

async function createTask(body: Record<string, unknown>) {
  const r = await fetch("/api/internal-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("Failed");
  return r.json();
}

async function updateTask(id: number, body: Record<string, unknown>) {
  const r = await fetch(`/api/internal-tasks/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("Failed");
  return r.json();
}

function isOverdue(deadline: string | null, status: string) {
  if (!deadline || status === "completed" || status === "cancelled") return false;
  return new Date(deadline) < new Date();
}

export default function InternalTasksPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id;

  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDept, setFilterDept] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editTask, setEditTask] = useState<any>(null);

  const [form, setForm] = useState({
    taskType: "follow_up",
    title: "",
    description: "",
    department: "",
    assignedTo: "",
    deadline: "",
    priority: "normal",
  });

  const { data: tasks = [], isLoading, refetch } = useQuery({
    queryKey: ["internal-tasks", filterStatus, filterDept, companyId],
    queryFn: () => {
      const p: Record<string, string> = {};
      if (filterStatus !== "all") p.status = filterStatus;
      if (filterDept !== "all") p.department = filterDept;
      if (companyId) p.companyId = String(companyId);
      return fetchTasks(p);
    },
  });

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => createTask({ ...body, companyId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["internal-tasks"] });
      toast({ title: "Task dibuat" });
      setShowForm(false);
      setForm({ taskType: "follow_up", title: "", description: "", department: "", assignedTo: "", deadline: "", priority: "normal" });
    },
    onError: () => toast({ title: "Gagal membuat task", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => updateTask(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["internal-tasks"] });
      toast({ title: "Task diupdate" });
      setEditTask(null);
    },
    onError: () => toast({ title: "Gagal update task", variant: "destructive" }),
  });

  const counts = {
    open: tasks.filter((t: any) => t.task.status === "open").length,
    in_progress: tasks.filter((t: any) => t.task.status === "in_progress").length,
    overdue: tasks.filter((t: any) => isOverdue(t.task.deadline, t.task.status)).length,
    completed: tasks.filter((t: any) => t.task.status === "completed").length,
  };

  return (
    <AppShell>
      <div className="p-4 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ClipboardList className="h-6 w-6 text-primary" />
              Internal Tasks
            </h1>
            <p className="text-muted-foreground text-sm">Penugasan internal per departemen</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-2" /> Buat Task
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Open", value: counts.open, icon: <Clock className="h-4 w-4 text-blue-500" />, color: "border-l-blue-500" },
            { label: "In Progress", value: counts.in_progress, icon: <RefreshCw className="h-4 w-4 text-yellow-500" />, color: "border-l-yellow-500" },
            { label: "Overdue", value: counts.overdue, icon: <AlertTriangle className="h-4 w-4 text-red-500" />, color: "border-l-red-500" },
            { label: "Completed", value: counts.completed, icon: <CheckCircle className="h-4 w-4 text-green-500" />, color: "border-l-green-500" },
          ].map(s => (
            <Card key={s.label} className={`border-l-4 ${s.color}`}>
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                  <div className="text-2xl font-bold">{s.value}</div>
                </div>
                {s.icon}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              {STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterDept} onValueChange={setFilterDept}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Dept</SelectItem>
              {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Departemen</TableHead>
                    <TableHead>Assign To</TableHead>
                    <TableHead>Deadline</TableHead>
                    <TableHead>Prioritas</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>
                  ) : tasks.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Belum ada task</TableCell></TableRow>
                  ) : tasks.map((row: any) => {
                    const t = row.task;
                    const overdue = isOverdue(t.deadline, t.status);
                    return (
                      <TableRow key={t.id} className={overdue ? "bg-red-50/40" : ""}>
                        <TableCell>
                          <div className="font-medium text-sm">{t.title}</div>
                          {t.orderNumber && <div className="text-xs text-muted-foreground">{t.orderNumber}</div>}
                          {t.description && <div className="text-xs text-muted-foreground truncate max-w-48">{t.description}</div>}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs">{t.department ?? "—"}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs">{t.assignedTo ?? row.assignee?.name ?? "—"}</span>
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs ${overdue ? "text-red-600 font-bold" : ""}`}>
                            {t.deadline ? format(new Date(t.deadline), "dd MMM HH:mm", { locale: id }) : "—"}
                            {overdue && " ⚠️"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[t.priority] ?? ""}`}>
                            {t.priority}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[t.status] ?? ""}`}>
                            {t.status.replace("_", " ")}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setEditTask(t)}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Create Dialog */}
        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Buat Internal Task</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Judul Task *</Label>
                <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Judul task..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipe Task</Label>
                  <Select value={form.taskType} onValueChange={v => setForm(f => ({ ...f, taskType: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TASK_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Prioritas</Label>
                  <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Departemen</Label>
                  <Select value={form.department} onValueChange={v => setForm(f => ({ ...f, department: v }))}>
                    <SelectTrigger><SelectValue placeholder="Pilih dept..." /></SelectTrigger>
                    <SelectContent>
                      {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Assign To</Label>
                  <Input value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))} placeholder="Nama/email..." />
                </div>
              </div>
              <div>
                <Label>Deadline</Label>
                <Input type="datetime-local" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
              </div>
              <div>
                <Label>Deskripsi</Label>
                <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Detail task..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
              <Button onClick={() => createMut.mutate(form)} disabled={!form.title || createMut.isPending}>
                {createMut.isPending ? "Menyimpan..." : "Buat Task"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={!!editTask} onOpenChange={() => setEditTask(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Update Task</DialogTitle>
            </DialogHeader>
            {editTask && (
              <div className="space-y-3">
                <div className="font-medium">{editTask.title}</div>
                <div>
                  <Label>Status</Label>
                  <Select
                    value={editTask.status}
                    onValueChange={v => setEditTask((t: any) => ({ ...t, status: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Prioritas</Label>
                  <Select
                    value={editTask.priority}
                    onValueChange={v => setEditTask((t: any) => ({ ...t, priority: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditTask(null)}>Batal</Button>
              <Button
                onClick={() => updateMut.mutate({ id: editTask.id, body: { status: editTask.status, priority: editTask.priority } })}
                disabled={updateMut.isPending}
              >
                {updateMut.isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
