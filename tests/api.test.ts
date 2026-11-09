import "./setup-env";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/server/app";
import { prisma } from "../src/server/db";
import { addDays, todayLocal } from "../src/shared/time";

const agent = request.agent(app);
const other = request.agent(app);
const email = `test-${Date.now()}@lifeflow.test`;
const today = todayLocal();
const tomorrow = addDays(today, 1);

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: "@lifeflow.test" } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: "@lifeflow.test" } } });
  await prisma.$disconnect();
});

describe("kimlik doğrulama", () => {
  it("yetkisiz istek 401 döner", async () => {
    const res = await request(app).get("/api/tasks");
    expect(res.status).toBe(401);
  });

  it("kayıt olur, varsayılan kategoriler ve ayarlar oluşur", async () => {
    const res = await agent.post("/api/auth/register").send({ name: "Test", email, password: "sifre1234" });
    expect(res.status).toBe(201);
    const cats = await agent.get("/api/categories");
    expect(cats.body.categories.length).toBeGreaterThanOrEqual(16);
    const s = await agent.get("/api/settings");
    expect(s.body.settings.wakeTime).toBe("07:00");
  });

  it("zayıf şifre ve çift kayıt reddedilir", async () => {
    expect((await request(app).post("/api/auth/register").send({ name: "x", email: "a@lifeflow.test", password: "123" })).status).toBe(400);
    expect((await request(app).post("/api/auth/register").send({ name: "x", email, password: "sifre1234" })).status).toBe(400);
  });

  it("yanlış şifre 401", async () => {
    expect((await request(app).post("/api/auth/login").send({ email, password: "yanlis123" })).status).toBe(401);
  });

  it("ikinci kullanıcı oluşturulur", async () => {
    const res = await other.post("/api/auth/register").send({ name: "Diğer", email: `other-${Date.now()}@lifeflow.test`, password: "sifre1234" });
    expect(res.status).toBe(201);
  });
});

let taskId = "";
let sporId = "";

describe("görevler", () => {
  it("görev oluşturur ve endTime hesaplanır", async () => {
    const res = await agent.post("/api/tasks").send({ title: "İngilizce", date: today, startTime: "19:00", durationMinutes: 60 });
    expect(res.status).toBe(201);
    expect(res.body.task.endTime).toBe("20:00");
    taskId = res.body.task.id;
  });

  it("geçersiz veri 400", async () => {
    expect((await agent.post("/api/tasks").send({ title: "", date: today })).status).toBe(400);
    expect((await agent.post("/api/tasks").send({ title: "x", date: "2026-13-40" })).status).toBe(400);
    expect((await agent.post("/api/tasks").send({ title: "x", date: today, startTime: "25:00" })).status).toBe(400);
  });

  it("listeler ve çakışmayı bildirir", async () => {
    const spor = await agent.post("/api/tasks").send({ title: "Spor", date: today, startTime: "19:30", durationMinutes: 60 });
    sporId = spor.body.task.id;
    const list = await agent.get(`/api/tasks?from=${today}&to=${today}`);
    expect(list.body.tasks).toHaveLength(2);
    expect(list.body.conflicts).toHaveLength(1);
  });

  it("günceller, tamamlar, erteler", async () => {
    const upd = await agent.patch(`/api/tasks/${sporId}`).send({ startTime: "21:00" });
    expect(upd.body.task.endTime).toBe("22:00");
    const done = await agent.patch(`/api/tasks/${taskId}`).send({ status: "DONE" });
    expect(done.body.task.completedAt).toBeTruthy();
    const post = await agent.patch(`/api/tasks/${sporId}`).send({ date: tomorrow, postponeCount: 1 });
    expect(post.body.task.date).toBe(tomorrow);
  });

  it("başka kullanıcının görevine erişemez", async () => {
    expect((await other.get(`/api/tasks/${taskId}`)).status).toBe(404);
    expect((await other.patch(`/api/tasks/${taskId}`).send({ title: "hack" })).status).toBe(404);
    expect((await other.delete(`/api/tasks/${taskId}`)).status).toBe(404);
    const list = await other.get(`/api/tasks?from=${today}&to=${tomorrow}`);
    expect(list.body.tasks).toHaveLength(0);
  });

  it("geri al / yeniden uygula çalışır", async () => {
    const del = await agent.delete(`/api/tasks/${sporId}`);
    expect(del.status).toBe(200);
    expect((await agent.get(`/api/tasks/${sporId}`)).status).toBe(404);
    const undo = await agent.post("/api/operations/undo");
    expect(undo.status).toBe(200);
    const back = await agent.get(`/api/tasks/${sporId}`);
    expect(back.status).toBe(200);
    expect(back.body.task.title).toBe("Spor");
    const redo = await agent.post("/api/operations/redo");
    expect(redo.status).toBe(200);
    expect((await agent.get(`/api/tasks/${sporId}`)).status).toBe(404);
    await agent.post("/api/operations/undo");
    const hist = await agent.get("/api/operations/history");
    expect(hist.body.history.length).toBeGreaterThan(3);
  });

  it("önizleme çakışma uyarısı verir", async () => {
    const res = await agent.post("/api/operations/preview").send({
      operations: [{ type: "update", taskId: sporId, changes: { date: today, startTime: "19:30" } }],
    });
    expect(res.status).toBe(200);
    expect(res.body.warnings.some((w: string) => w.includes("Çakışma"))).toBe(true);
  });
});

describe("tekrarlayan görevler", () => {
  let recId = "";
  it("seri oluşturur ve örnekleri üretir", async () => {
    const res = await agent.post("/api/recurrences").send({ title: "Yoga", frequency: "DAILY", startDate: today, startTime: "07:30", durationMinutes: 30 });
    expect(res.status).toBe(201);
    recId = res.body.recurrence.id;
    const list = await agent.get(`/api/tasks?from=${today}&to=${addDays(today, 6)}`);
    const yoga = list.body.tasks.filter((t: { recurrenceId: string }) => t.recurrenceId === recId);
    expect(yoga).toHaveLength(7);
  });

  it("tek örneği değiştirmek seriden ayırır; seriyi değiştirmek ayrılmamışları günceller", async () => {
    const list = await agent.get(`/api/tasks?from=${today}&to=${addDays(today, 2)}`);
    const yoga = list.body.tasks.filter((t: { recurrenceId: string }) => t.recurrenceId === recId);
    const single = await agent.patch(`/api/tasks/${yoga[0].id}`).send({ startTime: "08:00" });
    expect(single.body.task.detached).toBe(true);
    const cancel = await agent.patch(`/api/tasks/${yoga[1].id}`).send({ status: "CANCELLED" });
    expect(cancel.body.task.status).toBe("CANCELLED");
    const upd = await agent.patch(`/api/recurrences/${recId}`).send({ durationMinutes: 45 });
    expect(upd.status).toBe(200);
    const after = await agent.get(`/api/tasks?from=${today}&to=${addDays(today, 2)}`);
    const t0 = after.body.tasks.find((t: { id: string }) => t.id === yoga[0].id);
    const t1 = after.body.tasks.find((t: { id: string }) => t.id === yoga[1].id);
    const t2 = after.body.tasks.find((t: { id: string }) => t.id === yoga[2].id);
    expect(t0.durationMinutes).toBe(30); // ayrılmış örnek değişmez
    expect(t1.status).toBe("CANCELLED"); // iptal geçmişi korunur
    expect(t2.durationMinutes).toBe(45); // seri üyesi güncellenir
  });

  it("seri sonlandırılınca gelecek planlılar silinir, geçmiş korunur", async () => {
    const res = await agent.delete(`/api/recurrences/${recId}`);
    expect(res.status).toBe(200);
    const list = await agent.get(`/api/tasks?from=${today}&to=${addDays(today, 6)}`);
    const remaining = list.body.tasks.filter((t: { recurrenceId: string }) => t.recurrenceId === recId);
    expect(remaining.every((t: { status: string; detached: boolean }) => t.status === "CANCELLED" || t.detached)).toBe(true);
  });
});

describe("yeniden planlama uç noktası", () => {
  it("misafir senaryosu önizleme döndürür ve uygulanabilir", async () => {
    await agent.post("/api/tasks").send({ title: "Kodlama", date: tomorrow, startTime: "19:00", durationMinutes: 60, priority: "HIGH" });
    const res = await agent.post("/api/replan").send({ scenario: "free_window", date: tomorrow, start: "18:30", end: "22:00", blockTitle: "Misafir" });
    expect(res.status).toBe(200);
    expect(res.body.operations.length).toBeGreaterThanOrEqual(2);
    expect(res.body.preview.length).toBe(res.body.operations.length);
    const apply = await agent.post("/api/operations/apply").send({ operations: res.body.operations, description: "Misafir planı" });
    expect(apply.status).toBe(200);
    const list = await agent.get(`/api/tasks?from=${tomorrow}&to=${addDays(tomorrow, 7)}`);
    expect(list.body.tasks.some((t: { title: string }) => t.title === "Misafir")).toBe(true);
    expect(list.body.conflicts).toHaveLength(0);
  });

  it("boş dilimleri döndürür", async () => {
    const res = await agent.get(`/api/replan/free-slots?date=${tomorrow}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.slots)).toBe(true);
  });

  it("geçersiz senaryo 400", async () => {
    expect((await agent.post("/api/replan").send({ scenario: "uçur" })).status).toBe(400);
  });
});

describe("alışkanlık, hedef, istatistik, dışa aktarma", () => {
  it("alışkanlık oluşturur ve seri hesaplar", async () => {
    const h = await agent.post("/api/habits").send({ name: "Su iç" });
    expect(h.status).toBe(201);
    await agent.post(`/api/habits/${h.body.habit.id}/log`).send({ date: today, status: "DONE" });
    await agent.post(`/api/habits/${h.body.habit.id}/log`).send({ date: addDays(today, -1), status: "DONE" });
    await agent.post(`/api/habits/${h.body.habit.id}/log`).send({ date: addDays(today, -2), status: "SKIPPED" });
    const list = await agent.get("/api/habits");
    const mine = list.body.habits.find((x: { id: string }) => x.id === h.body.habit.id);
    expect(mine.streak).toBe(2);
    expect(mine.totalDone).toBe(2);
  });

  it("hedef ve aşama ilerlemesi", async () => {
    const g = await agent.post("/api/goals").send({ title: "B2 İngilizce", area: "english", milestones: ["Seviye belirleme", "Gramer"] });
    expect(g.status).toBe(201);
    const m = g.body.goal.milestones[0];
    await agent.patch(`/api/goals/${g.body.goal.id}/milestones/${m.id}`).send({ done: true });
    const list = await agent.get("/api/goals");
    const mine = list.body.goals.find((x: { id: string }) => x.id === g.body.goal.id);
    expect(mine.progress).toBe(50);
  });

  it("istatistik gerçek veriye dayanır", async () => {
    const res = await agent.get(`/api/stats?range=week&date=${today}`);
    expect(res.status).toBe(200);
    expect(res.body.totals.done).toBeGreaterThanOrEqual(1);
    expect(res.body.byDay.length).toBe(7);
  });

  it("JSON ve CSV dışa aktarma", async () => {
    const j = await agent.get("/api/data/export.json");
    expect(j.status).toBe(200);
    expect(j.body.tasks.length).toBeGreaterThan(0);
    const c = await agent.get("/api/data/export.csv");
    expect(c.status).toBe(200);
    expect(c.text).toContain("baslik");
  });

  it("AI anahtarı yokken sohbet 503 döner", async () => {
    const res = await agent.post("/api/ai/chat").send({ message: "yarın için program hazırla" });
    expect(res.status).toBe(503);
  });

  it("hesabı siler", async () => {
    const res = await agent.delete("/api/data/account").send({ confirm: "SİL" });
    expect(res.status).toBe(200);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });
});
