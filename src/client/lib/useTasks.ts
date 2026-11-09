// Görev listesi ve hızlı işlemler (tamamla, ertele, yarına taşı, yapamadım, iptal).

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useStore, errorText } from "./store";
import type { TaskDTO, PreviewLine, Operation } from "@shared/types";
import { addDays } from "@shared/time";

export interface ReplanResponse {
  operations: Operation[];
  explanation: string[];
  warnings: string[];
  affected: { id: string; title: string; date: string; startTime: string | null }[];
  preview: PreviewLine[];
}

export function useTasks(from: string, to: string) {
  const { toast } = useStore();
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [conflicts, setConflicts] = useState<{ a: string; b: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<(ReplanResponse & { description: string }) | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await api.get<{ tasks: TaskDTO[]; conflicts: { a: string; b: string }[] }>(`/api/tasks?from=${from}&to=${to}`);
      setTasks(r.tasks);
      setConflicts(r.conflicts);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setLoading(false);
    }
  }, [from, to, toast]);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  const conflictIds = new Set(conflicts.flatMap((c) => [c.a, c.b]));

  async function toggleDone(t: TaskDTO) {
    try {
      await api.patch(`/api/tasks/${t.id}`, { status: t.status === "DONE" ? "PLANNED" : "DONE" });
      await reload();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  async function runScenario(body: Record<string, unknown>, description: string) {
    try {
      const r = await api.post<ReplanResponse>("/api/replan", body);
      if (r.operations.length === 0) {
        toast(r.explanation[0] ?? "Değişiklik gerekmiyor");
        return;
      }
      setPending({ ...r, description });
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  async function applyPending() {
    if (!pending) return;
    try {
      await api.post("/api/operations/apply", { operations: pending.operations, description: pending.description });
      toast("Plan güncellendi (geri alınabilir)", "success");
      setPending(null);
      await reload();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  async function cancelTask(t: TaskDTO) {
    try {
      await api.patch(`/api/tasks/${t.id}`, { status: t.status === "CANCELLED" ? "PLANNED" : "CANCELLED" });
      await reload();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  async function moveTo(t: TaskDTO, date: string, startTime?: string | null) {
    if (startTime === undefined) {
      await runScenario({ scenario: "move", taskId: t.id, targetDate: date }, `"${t.title}" ${date} tarihine taşındı`);
      return;
    }
    try {
      await api.patch(`/api/tasks/${t.id}`, { date, startTime, postponeCount: date !== t.date ? t.postponeCount + 1 : t.postponeCount });
      await reload();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  async function undo() {
    try {
      const r = await api.post<{ description: string }>("/api/operations/undo");
      toast(`Geri alındı: ${r.description}`, "success");
      await reload();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  async function redo() {
    try {
      const r = await api.post<{ description: string }>("/api/operations/redo");
      toast(`Yeniden uygulandı: ${r.description}`, "success");
      await reload();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  const actions = {
    onToggleDone: toggleDone,
    onEdit: ((_t: TaskDTO) => undefined) as (t: TaskDTO) => void,
    onPostpone: (t: TaskDTO, minutes: number) => runScenario({ scenario: "postpone", taskId: t.id, minutes }, `"${t.title}" ${minutes} dk ertelendi`),
    onMoveTomorrow: (t: TaskDTO) => runScenario({ scenario: "move", taskId: t.id, targetDate: addDays(t.date, 1) }, `"${t.title}" yarına taşındı`),
    onFailed: (t: TaskDTO) => runScenario({ scenario: "failed", taskId: t.id, reschedule: true }, `"${t.title}" yapılamadı, yeniden planlandı`),
    onCancel: cancelTask,
  };

  return { tasks, conflicts, conflictIds, loading, reload, actions, pending, setPending, applyPending, runScenario, moveTo, undo, redo };
}
