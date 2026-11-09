export const DEFAULT_CATEGORIES: { name: string; color: string; icon: string; weeklyTargetMinutes: number }[] = [
  { name: "İş", color: "#64748b", icon: "briefcase", weeklyTargetMinutes: 0 },
  { name: "Kariyer", color: "#0ea5e9", icon: "trending-up", weeklyTargetMinutes: 120 },
  { name: "Eğitim", color: "#8b5cf6", icon: "graduation-cap", weeklyTargetMinutes: 180 },
  { name: "İngilizce", color: "#2563eb", icon: "languages", weeklyTargetMinutes: 240 },
  { name: "Yazılım", color: "#16a34a", icon: "code", weeklyTargetMinutes: 300 },
  { name: "Astroloji", color: "#a855f7", icon: "sparkles", weeklyTargetMinutes: 120 },
  { name: "Spor", color: "#f97316", icon: "dumbbell", weeklyTargetMinutes: 180 },
  { name: "Yoga", color: "#14b8a6", icon: "flower", weeklyTargetMinutes: 90 },
  { name: "Sağlık", color: "#ef4444", icon: "heart-pulse", weeklyTargetMinutes: 0 },
  { name: "Ev işleri", color: "#eab308", icon: "home", weeklyTargetMinutes: 180 },
  { name: "Kişisel bakım", color: "#ec4899", icon: "smile", weeklyTargetMinutes: 120 },
  { name: "Sosyal hayat", color: "#f59e0b", icon: "users", weeklyTargetMinutes: 180 },
  { name: "Dinlenme", color: "#06b6d4", icon: "coffee", weeklyTargetMinutes: 420 },
  { name: "Oyun", color: "#6366f1", icon: "gamepad-2", weeklyTargetMinutes: 300 },
  { name: "Finans", color: "#22c55e", icon: "wallet", weeklyTargetMinutes: 30 },
  { name: "Diğer", color: "#9ca3af", icon: "circle", weeklyTargetMinutes: 0 },
];

export const LEARNING_AREAS: { key: string; label: string; topics: string[] }[] = [
  {
    key: "english",
    label: "İngilizce",
    topics: ["Seviye belirleme", "Konu listesi", "Kelime takibi", "Gramer", "Okuma", "Dinleme", "Konuşma"],
  },
  {
    key: "astrology",
    label: "Astroloji",
    topics: [
      "Batı astrolojisi", "Vedik astroloji", "Temel kavramlar", "Gezegenler",
      "Burçlar", "Evler", "Açılar", "Harita yorumlama",
    ],
  },
  {
    key: "software",
    label: "Yazılım",
    topics: ["Teknoloji öğrenme", "Proje yönetimi", "Görevler", "Kodlama süreleri", "Proje ilerlemesi"],
  },
  { key: "general", label: "Genel", topics: [] },
];
