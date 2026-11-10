import { describe, it, expect, beforeAll } from "vitest";
import { handle } from "../src/core/router";
import { useStorage, MemoryStorage, CoreError } from "../src/core/db";
import { addDays, todayLocal } from "../src/shared/time";

type M = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
async function call(method: M, url: string, body?: unknown): Promise<{ status: number; body: any }> {
  try {
    return { status: 200, body: await handle(method, url, body) };
  } catch (e) {
    if (e instanceof CoreError) return { status: e.status, body: { error: e.message } };
    throw e;
  }
}
const get = (u: string) => call("GET", u);
const post = (u: string, b?: unknown) => call("POST", u, b ?? {});
const patch = (u: string, b?: unknown) => call("PATCH", u, b ?? {});
const del = (u: string, b?: unknown) => call("DELETE", u, b);

const today = todayLocal();
const tomorrow = addDays(today, 1);

beforeAll(() => {
  useStorage(new MemoryStorage());
});

describe("başlangıç", () => {
  it("varsayılan kategoriler ve ayarlar hazır gelir", async () => {
    const cats = await get("/api/categories");
    expect(cats.body.categories.length).toBeGreaterThanOrEqual(16);
    const s = await get("/api/settings");
    expect(s.body.settings.wakeTime).toBe("07:00");
    const me = await get("/api/auth/me");
    expect(me.body.user.name).toBeTruthy();
  });
  it("bilinmeyen yol 404", async () => {
    expect((await get("/api/yok")).status).toBe(404);
  });
});

let taskId = "";
let sporId = "";

describe("görevler", () => {
  it("görev oluşturur ve endTime hesaplanır", async () => {
    const res = await post("/api/tasks", { title: "İngilizce", date: today, startTime: "19:00", durationMinutes: 60 });
    expect(res.status).toBe(200);
    expect(res.body.task.endTime).toBe("20:00");
    taskId = res.body.task.id;
  });
  it("geçersiz veri 400", async () => {
    expect((await post("/api/tasks", { title: "", date: today })).status).toBe(400);
    expect((await post("/api/tasks", { title: "x", date: "2026-13-40" })).status).toBe(400);
    expect((await post("/api/tasks", { title: "x", date: today, startTime: "25:00" })).status).toBe(400);
  });
  it("listeler ve çakışmayı bildirir", async () => {
    const spor = await post("/api/tasks", { title: "Spor", date: today, startTime: "19:30", durationMinutes: 60 });
    sporId = spor.body.task.id;
    const list = await get(`/api/tasks?from=${today}&to=${today}`);
    expect(list.body.tasks).toHaveLength(2);
    expect(list.body.conflicts).toHaveLength(1);
  });
  it("günceller, tamamlar, erteler", async () => {
    const upd = await patch(`/api/tasks/${sporId}`, { startTime: "21:00" });
    expect(upd.body.task.endTime).toBe("22:00");
    const done = await patch(`/api/tasks/${taskId}`, { status: "DONE" });
    expect(done.body.task.completedAt).toBeTruthy();
    const p = await patch(`/api/tasks/${sporId}`, { date: tomorrow, postponeCount: 1 });
    expect(p.body.task.date).toBe(tomorrow);
  });
  it("geri al / yeniden uygula çalışır", async () => {
    expect((await del(`/api/tasks/${sporId}`)).status).toBe(200);
    expect((await get(`/api/tasks/${sporId}`)).status).toBe(404);
    expect((await post("/api/operations/undo")).status).toBe(200);
    const back = await get(`/api/tasks/${sporId}`);
    expect(back.status).toBe(200);
    expect(back.body.task.title).toBe("Spor");
    expect((await post("/api/operations/redo")).status).toBe(200);
    expect((await get(`/api/tasks/${sporId}`)).status).toBe(404);
    await post("/api/operations/undo");
    const hist = await get("/api/operations/history");
    expect(hist.body.history.length).toBeGreaterThan(3);
  });
  it("önizleme çakışma uyarısı verir", async () => {
    const res = await post("/api/operations/preview", { operations: [{ type: "update", taskId: sporId, changes: { date: today, startTime: "19:30" } }] });
    expect(res.status).toBe(200);
    expect(res.body.warnings.some((w: string) => w.includes("Çakışma"))).toBe(true);
  });
  it("hatalı operasyon listesi hiçbir şeyi değiştirmez", async () => {
    const before = (await get(`/api/tasks?from=${today}&to=${tomorrow}`)).body.tasks.length;
    const res = await post("/api/operations/apply", { operations: [{ type: "create", task: { title: "A", date: today } }, { type: "delete", taskId: "yok" }] });
    expect(res.status).toBe(404);
    const after = (await get(`/api/tasks?from=${today}&to=${tomorrow}`)).body.tasks.length;
    expect(after).toBe(before);
  });
});

describe("tekrarlayan görevler", () => {
  let recId = "";
  it("seri oluşturur ve örnekleri üretir", async () => {
    const res = await post("/api/recurrences", { title: "Yoga", frequency: "DAILY", startDate: today, startTime: "07:30", durationMinutes: 30 });
    expect(res.status).toBe(200);
    recId = res.body.recurrence.id;
    const list = await get(`/api/tasks?from=${today}&to=${addDays(today, 6)}`);
    expect(list.body.tasks.filter((t: { recurrenceId: string }) => t.recurrenceId === recId)).toHaveLength(7);
  });
  it("tek örneği değiştirmek seriden ayırır; seriyi değiştirmek ayrılmamışları günceller", async () => {
    const list = await get(`/api/tasks?from=${today}&to=${addDays(today, 2)}`);
    const yoga = list.body.tasks.filter((t: { recurrenceId: string }) => t.recurrenceId === recId);
    const single = await patch(`/api/tasks/${yoga[0].id}`, { startTime: "08:00" });
    expect(single.body.task.detached).toBe(true);
    await patch(`/api/tasks/${yoga[1].id}`, { status: "CANCELLED" });
    expect((await patch(`/api/recurrences/${recId}`, { durationMinutes: 45 })).status).toBe(200);
    const after = await get(`/api/tasks?from=${today}&to=${addDays(today, 2)}`);
    const find = (id: string) => after.body.tasks.find((t: { id: string }) => t.id === id);
    expect(find(yoga[0].id).durationMinutes).toBe(30);
    expect(find(yoga[1].id).status).toBe("CANCELLED");
    expect(find(yoga[2].id).durationMinutes).toBe(45);
  });
  it("seri sonlandırılınca gelecek planlılar silinir, geçmiş korunur", async () => {
    expect((await del(`/api/recurrences/${recId}`)).status).toBe(200);
    const list = await get(`/api/tasks?from=${today}&to=${addDays(today, 6)}`);
    const remaining = list.body.tasks.filter((t: { recurrenceId: string }) => t.recurrenceId === recId);
    expect(remaining.every((t: { status: string; detached: boolean }) => t.status === "CANCELLED" || t.detached)).toBe(true);
  });
});

describe("yeniden planlama", () => {
  it("misafir senaryosu önizleme döndürür ve uygulanabilir", async () => {
    await post("/api/tasks", { title: "Kodlama", date: tomorrow, startTime: "19:00", durationMinutes: 60, priority: "HIGH" });
    const res = await post("/api/replan", { scenario: "free_window", date: tomorrow, start: "18:30", end: "22:00", blockTitle: "Misafir" });
    expect(res.status).toBe(200);
    expect(res.body.operations.length).toBeGreaterThanOrEqual(2);
    expect(res.body.preview.length).toBe(res.body.operations.length);
    expect((await post("/api/operations/apply", { operations: res.body.operations, description: "Misafir planı" })).status).toBe(200);
    const list = await get(`/api/tasks?from=${tomorrow}&to=${addDays(tomorrow, 7)}`);
    expect(list.body.tasks.some((t: { title: string }) => t.title === "Misafir")).toBe(true);
    expect(list.body.conflicts).toHaveLength(0);
  });
  it("boş dilimleri döndürür ve geçersiz senaryo 400", async () => {
    const res = await get(`/api/replan/free-slots?date=${tomorrow}`);
    expect(Array.isArray(res.body.slots)).toBe(true);
    expect((await post("/api/replan", { scenario: "uçur" })).status).toBe(400);
  });
  it("günü planla ve telafi çalışır", async () => {
    await post("/api/tasks", { title: "Eski görev", date: addDays(today, -2), startTime: "19:00", durationMinutes: 30, priority: "HIGH" });
    const c = await post("/api/replan", { scenario: "catch_up", horizonDays: 7 });
    expect(c.body.operations.length).toBeGreaterThanOrEqual(1);
    const p = await post("/api/replan", { scenario: "plan_day", date: addDays(today, 5) });
    expect(p.status).toBe(200);
  });
});

describe("alışkanlık, hedef, şablon, istatistik, veri", () => {
  it("alışkanlık oluşturur ve seri hesaplar", async () => {
    const h = await post("/api/habits", { name: "Su iç" });
    await post(`/api/habits/${h.body.habit.id}/log`, { date: today, status: "DONE" });
    await post(`/api/habits/${h.body.habit.id}/log`, { date: addDays(today, -1), status: "DONE" });
    await post(`/api/habits/${h.body.habit.id}/log`, { date: addDays(today, -2), status: "SKIPPED" });
    const list = await get("/api/habits");
    const mine = list.body.habits.find((x: { id: string }) => x.id === h.body.habit.id);
    expect(mine.streak).toBe(2);
    expect(mine.totalDone).toBe(2);
    await del(`/api/habits/${h.body.habit.id}`);
    expect((await get("/api/habits")).body.habits.some((x: { id: string }) => x.id === h.body.habit.id)).toBe(false);
    expect((await get("/api/habits?all=1")).body.habits.some((x: { id: string }) => x.id === h.body.habit.id)).toBe(true);
  });
  it("hedef ve aşama ilerlemesi", async () => {
    const g = await post("/api/goals", { title: "B2 İngilizce", area: "english", milestones: ["Seviye belirleme", "Gramer"] });
    const m = g.body.goal.milestones[0];
    await patch(`/api/goals/${g.body.goal.id}/milestones/${m.id}`, { done: true });
    const mine = (await get("/api/goals")).body.goals.find((x: { id: string }) => x.id === g.body.goal.id);
    expect(mine.progress).toBe(50);
    await post("/api/notes", { goalId: g.body.goal.id, kind: "vocab", title: "diligent", content: "çalışkan" });
    expect((await get(`/api/notes?goalId=${g.body.goal.id}`)).body.notes).toHaveLength(1);
  });
  it("şablon kaydeder ve uygular", async () => {
    const t = await post("/api/templates", { name: "Normal gün", kind: "DAY", sourceDate: today });
    expect(t.status).toBe(200);
    const a = await post(`/api/templates/${t.body.template.id}/apply`, { targetDate: addDays(today, 10) });
    expect(a.body.applied).toBeGreaterThan(0);
  });
  it("gün kopyalama", async () => {
    const r = await post("/api/tasks/copy", { kind: "DAY", sourceDate: today, targetDate: addDays(today, 11) });
    expect(r.body.copied).toBeGreaterThan(0);
  });
  it("istatistik gerçek veriye dayanır", async () => {
    const res = await get(`/api/stats?range=week&date=${today}`);
    expect(res.body.totals.done).toBeGreaterThanOrEqual(1);
    expect(res.body.byDay.length).toBe(7);
  });
  it("JSON ve CSV dışa aktarma; JSON içe aktarma", async () => {
    const j = await get("/api/data/export.json");
    const parsed = JSON.parse(j.body.content);
    expect(parsed.tasks.length).toBeGreaterThan(0);
    expect(parsed.ai).toBeUndefined();
    const c = await get("/api/data/export.csv");
    expect(c.body.content).toContain("baslik");
    const before = (await get(`/api/tasks?from=${today}&to=${today}`)).body.tasks.length;
    const imp = await post("/api/data/import", { tasks: [{ title: "İçe aktarılan", date: today }], categories: [], habits: [] });
    expect(imp.body.imported.tasks).toBe(1);
    expect((await get(`/api/tasks?from=${today}&to=${today}`)).body.tasks.length).toBe(before + 1);
  });
  it("AI anahtarı yokken sohbet 503, anahtar ayarı kaydedilir", async () => {
    expect((await post("/api/ai/chat", { message: "yarın için program hazırla" })).status).toBe(503);
    const st = await call("PUT", "/api/ai/config", { model: "claude-opus-5-5", dailyLimit: 10 });
    expect(st.body.dailyLimit).toBe(10);
  });
  it("tüm verileri siler", async () => {
    expect((await del("/api/data/account", { confirm: "SİL" })).status).toBe(200);
    expect((await get(`/api/tasks?from=${today}&to=${tomorrow}`)).body.tasks).toHaveLength(0);
    expect((await get("/api/categories")).body.categories.length).toBeGreaterThanOrEqual(16);
  });
});
