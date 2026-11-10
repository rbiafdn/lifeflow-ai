import { describe, it, expect } from "vitest";
import { freeSlots, findSlot, detectConflicts, placeOnDay, type PlannerTask, type PlannerSettings, totalFreeMinutes } from "../src/shared/planner/slots";
import { moveTask, postponeTask, freeWindow, lightenWeek, catchUp, markFailedAndReschedule, planDay, type PlannerContext } from "../src/shared/planner/replan";
import { toMinutes, weekStart, addDays } from "../src/shared/time";

const settings: PlannerSettings = {
  wakeTime: "07:00",
  sleepTime: "23:30",
  workStart: "09:00",
  workEnd: "18:00",
  workDays: [1, 2, 3, 4, 5],
  commuteMinutes: 30,
  dailyFreeMinutes: 60,
  focusStart: "19:00",
  focusEnd: "22:00",
  restDays: [0],
  sportDays: [1, 3, 5],
};

let seq = 0;
function task(p: Partial<PlannerTask> & { date: string; title?: string }): PlannerTask {
  return {
    id: p.id ?? `t${++seq}`,
    title: p.title ?? "Görev",
    date: p.date,
    startTime: p.startTime ?? null,
    durationMinutes: p.durationMinutes ?? 60,
    priority: p.priority ?? "MEDIUM",
    timeType: p.timeType ?? "FLEXIBLE",
    flexibility: p.flexibility ?? 1,
    deadline: p.deadline ?? null,
    status: p.status ?? "PLANNED",
    categoryId: p.categoryId ?? null,
    difficulty: p.difficulty ?? 2,
    postponeCount: p.postponeCount ?? 0,
  };
}

// 2026-11-09 Pazartesi
const MON = "2026-11-09";
const TUE = "2026-11-10";
const THU = "2026-11-12";

function ctx(tasks: PlannerTask[], today = MON): PlannerContext {
  return { today, settings, tasks };
}

describe("boş zaman dilimleri", () => {
  it("iş günü: iş + yol süresi düşülür", () => {
    const slots = freeSlots(MON, settings, []);
    // 07:00-08:30 ve 18:30-23:30
    expect(slots).toEqual([
      { start: toMinutes("07:00"), end: toMinutes("08:30") },
      { start: toMinutes("18:30"), end: toMinutes("23:30") },
    ]);
  });

  it("hafta sonu: tüm uyanıklık boş", () => {
    const slots = freeSlots("2026-11-14", settings, []);
    expect(slots).toEqual([{ start: toMinutes("07:00"), end: toMinutes("23:30") }]);
  });

  it("planlı görev tamponla birlikte düşülür, iptal edilen düşülmez", () => {
    const tasks = [
      task({ date: MON, startTime: "19:00", durationMinutes: 60 }),
      task({ date: MON, startTime: "21:00", durationMinutes: 60, status: "CANCELLED" }),
    ];
    const slots = freeSlots(MON, settings, tasks);
    expect(slots.some((s) => s.start === toMinutes("20:10"))).toBe(true);
    expect(totalFreeMinutes(slots)).toBe(90 + (toMinutes("23:30") - toMinutes("20:10")) + (toMinutes("18:50") - toMinutes("18:30")));
  });

  it("findSlot tercih edilen pencereyi önceler", () => {
    const slots = freeSlots(MON, settings, []);
    expect(findSlot(slots, 60, { preferredWindow: { start: toMinutes("19:00"), end: toMinutes("22:00") } })).toBe(toMinutes("19:00"));
    expect(findSlot(slots, 60)).toBe(toMinutes("07:00"));
    expect(findSlot(slots, 600)).toBeNull();
  });
});

describe("çakışma tespiti", () => {
  it("üst üste binen görevleri bulur", () => {
    const a = task({ date: MON, startTime: "19:00", durationMinutes: 60 });
    const b = task({ date: MON, startTime: "19:30", durationMinutes: 60 });
    const c = task({ date: TUE, startTime: "19:30", durationMinutes: 60 });
    const conflicts = detectConflicts([a, b, c]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].overlapMinutes).toBe(30);
  });
});

describe("placeOnDay", () => {
  it("opsiyonel görev dinlenme payını yiyorsa yerleştirilmez", () => {
    const existing = [task({ date: MON, startTime: "18:30", durationMinutes: 240 })];
    // 22:40-23:30 = 50 dk kaldı; 07:00-08:30 = 90 dk
    const res = placeOnDay(MON, settings, existing, [
      task({ date: MON, title: "Opsiyonel", timeType: "OPTIONAL", durationMinutes: 60 }),
      task({ date: MON, title: "Önemli", priority: "HIGH", durationMinutes: 30 }),
    ]);
    expect(res.placed.map((p) => p.item.title)).toEqual(["Önemli"]);
    expect(res.unplaced.map((u) => u.title)).toEqual(["Opsiyonel"]);
  });
});

describe("Senaryo: görevi taşı", () => {
  it("boş güne saatiyle taşır", () => {
    const spor = task({ id: "spor", title: "Spor", date: MON, startTime: "19:00", durationMinutes: 60 });
    const r = moveTask(ctx([spor]), spor, THU);
    expect(r.operations).toHaveLength(1);
    expect(r.operations[0]).toMatchObject({ type: "update", taskId: "spor", changes: { date: THU, startTime: "19:00" } });
    expect(r.warnings).toHaveLength(0);
  });

  it("hedef saat doluysa en yakın boş saati seçer ve uyarır", () => {
    const spor = task({ id: "spor", title: "Spor", date: MON, startTime: "19:00", durationMinutes: 60 });
    const ders = task({ id: "ders", title: "İngilizce", date: THU, startTime: "19:00", durationMinutes: 60 });
    const r = moveTask(ctx([spor, ders]), spor, THU, "19:00");
    const op = r.operations[0] as { changes: { startTime: string } };
    expect(op.changes.startTime).not.toBe("19:00");
    expect(r.warnings[0]).toContain("çakışıyor");
    // yeni saat ders ile çakışmamalı
    const probe = { ...spor, date: THU, startTime: op.changes.startTime };
    expect(detectConflicts([probe, ders])).toHaveLength(0);
  });

  it("sabit görev taşınırsa uyarı üretir", () => {
    const toplanti = task({ id: "m", title: "Toplantı", date: MON, startTime: "19:00", timeType: "FIXED", flexibility: 0 });
    const r = moveTask(ctx([toplanti]), toplanti, TUE);
    expect(r.warnings[0]).toContain("sabit");
  });
});

describe("Senaryo B: ertele", () => {
  it("bir saat erteler, dolu ise sonraki boşluğu bulur", () => {
    const ing = task({ id: "ing", title: "İngilizce", date: MON, startTime: "19:00", durationMinutes: 60 });
    const r1 = postponeTask(ctx([ing]), ing, 60);
    expect(r1.operations[0]).toMatchObject({ changes: { date: MON, startTime: "20:00", postponeCount: 1 } });

    const spor = task({ id: "spor", title: "Spor", date: MON, startTime: "20:00", durationMinutes: 60 });
    const r2 = postponeTask(ctx([ing, spor]), ing, 60);
    const op = r2.operations[0] as { changes: { startTime: string } };
    expect(op.changes.startTime).toBe("21:10");
    expect(r2.warnings.length).toBeGreaterThan(0);
  });

  it("günde yer kalmazsa ertesi güne önerir", () => {
    const ing = task({ id: "ing", title: "İngilizce", date: MON, startTime: "22:00", durationMinutes: 60 });
    const r = postponeTask(ctx([ing]), ing, 120);
    const op = r.operations[0] as { changes: { date: string } };
    expect(op.changes.date).toBe(TUE);
  });
});

describe("Senaryo C: aralığı boşalt (misafir)", () => {
  it("esnek görevleri taşır, sabitleri taşımaz, dinlenmeyi korur, misafir bloğu ekler", () => {
    const tasks = [
      task({ id: "ing", title: "İngilizce", date: MON, startTime: "19:00", durationMinutes: 60 }),
      task({ id: "kod", title: "Kodlama", date: MON, startTime: "20:00", durationMinutes: 60, priority: "HIGH" }),
      task({ id: "rest", title: "Dinlenme", date: MON, startTime: "21:30", durationMinutes: 60, timeType: "REST" }),
      task({ id: "fix", title: "Online toplantı", date: MON, startTime: "22:30", durationMinutes: 30, timeType: "FIXED", flexibility: 0 }),
    ];
    const r = freeWindow(ctx(tasks), MON, "19:00", "23:00", { blockTitle: "Misafir" });
    expect(r.operations.some((o) => o.type === "create" && o.task.title === "Misafir")).toBe(true);
    expect(r.warnings.some((w) => w.includes("Online toplantı"))).toBe(true);
    expect(r.operations.find((o) => o.type === "update" && o.taskId === "fix")).toBeUndefined();
    const ingOp = r.operations.find((o) => o.type === "update" && o.taskId === "ing") as { changes: { date: string; startTime: string } };
    const kodOp = r.operations.find((o) => o.type === "update" && o.taskId === "kod") as { changes: { date: string; startTime: string } };
    expect(ingOp).toBeDefined();
    expect(kodOp).toBeDefined();
    // Aynı gün 07:00-08:30 sığar (ikisi için 60+60+tampon > 90 → biri sabah, biri sonraki güne)
    const sameDay = [ingOp, kodOp].filter((o) => o.changes.date === MON);
    expect(sameDay.length).toBeGreaterThanOrEqual(1);
    // Yüksek öncelikli olan (Kodlama) aynı güne yerleşmeli
    expect(kodOp.changes.date).toBe(MON);
    // Sonuç çakışmasız
    const final = tasks.map((t) => {
      const op = r.operations.find((o) => o.type === "update" && o.taskId === t.id) as { changes: Partial<PlannerTask> } | undefined;
      return op ? { ...t, ...op.changes } : t;
    });
    expect(detectConflicts(final.filter((t) => t.status === "PLANNED"))).toHaveLength(0);
  });
});

describe("Senaryo A: görevi yapamadım", () => {
  it("başarısız işaretler ve yeni zaman önerir", () => {
    const spor = task({ id: "spor", title: "Spor", date: MON, startTime: "19:00", durationMinutes: 60 });
    const r = markFailedAndReschedule(ctx([spor]), spor, true);
    expect(r.operations[0]).toMatchObject({ type: "update", taskId: "spor", changes: { status: "FAILED" } });
    expect(r.operations[1]).toMatchObject({ type: "create", task: { title: "Spor", date: TUE, startTime: "19:00" } });
  });
});

describe("Senaryo F: haftayı hafiflet", () => {
  it("düşük öncelikli görevleri gelecek haftaya alır, yüksek öncelikli ve sabitleri korur", () => {
    const tasks = [
      task({ id: "opt", title: "Oyun", date: TUE, startTime: "19:00", timeType: "OPTIONAL", priority: "LOW" }),
      task({ id: "low", title: "Kitap", date: THU, startTime: "19:00", priority: "LOW" }),
      task({ id: "high", title: "Proje", date: THU, startTime: "20:30", priority: "HIGH" }),
      task({ id: "fix", title: "Toplantı", date: TUE, startTime: "20:30", timeType: "FIXED", flexibility: 0, priority: "LOW" }),
    ];
    const r = lightenWeek(ctx(tasks), MON);
    const ids = r.operations.filter((o) => o.type === "update").map((o) => (o as { taskId: string }).taskId);
    expect(ids).toContain("opt");
    expect(ids).toContain("low");
    expect(ids).not.toContain("high");
    expect(ids).not.toContain("fix");
    const optOp = r.operations.find((o) => o.type === "update" && o.taskId === "opt") as { changes: { date: string } };
    expect(optOp.changes.date >= addDays(weekStart(MON), 7)).toBe(true);
    // dinlenme blokları eklenir
    expect(r.operations.some((o) => o.type === "create" && o.task.timeType === "REST")).toBe(true);
  });
});

describe("Senaryo G/H: biriken görevler", () => {
  it("hepsini aynı güne yığmaz, düşük öncelikli eskileri iptal önerir", () => {
    const backlog: PlannerTask[] = [];
    for (let i = 0; i < 6; i++) {
      backlog.push(task({ id: `b${i}`, title: `Biriken ${i}`, date: addDays(MON, -3 - i), startTime: "19:00", durationMinutes: 60, priority: i < 3 ? "HIGH" : "MEDIUM" }));
    }
    backlog.push(task({ id: "old-opt", title: "Eski opsiyonel", date: addDays(MON, -20), timeType: "OPTIONAL", priority: "LOW" }));
    const r = catchUp(ctx(backlog), { horizonDays: 7 });
    const moved = r.operations.filter((o) => o.type === "update" && (o as { changes: { date?: string } }).changes.date) as Array<{ changes: { date: string } }>;
    const perDay = new Map<string, number>();
    for (const m of moved) perDay.set(m.changes.date, (perDay.get(m.changes.date) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(2);
    expect(r.operations.some((o) => o.type === "update" && o.taskId === "old-opt" && o.changes.status === "CANCELLED")).toBe(true);
    expect(moved.length).toBe(6);
  });
});

describe("Boş günü planla", () => {
  it("önerileri çakışmasız yerleştirir ve dinlenme payını bırakır", () => {
    const r = planDay(ctx([]), "2026-11-14", [
      { title: "İngilizce", categoryId: null, durationMinutes: 60, priority: "HIGH", timeType: "FLEXIBLE", difficulty: 3, reason: "" },
      { title: "Kodlama", categoryId: null, durationMinutes: 120, priority: "HIGH", timeType: "PRIORITY", difficulty: 4, reason: "" },
      { title: "Spor", categoryId: null, durationMinutes: 60, priority: "MEDIUM", timeType: "FLEXIBLE", difficulty: 2, reason: "" },
      { title: "Dinlenme", categoryId: null, durationMinutes: 60, priority: "MEDIUM", timeType: "REST", difficulty: 1, reason: "" },
    ]);
    const creates = r.operations.filter((o) => o.type === "create") as Array<{ task: { title: string; date: string; startTime: string | null; durationMinutes: number } }>;
    expect(creates).toHaveLength(4);
    const probe = creates.map((c, i) => task({ id: `n${i}`, date: c.task.date, startTime: c.task.startTime, durationMinutes: c.task.durationMinutes }));
    expect(detectConflicts(probe)).toHaveLength(0);
  });
});
