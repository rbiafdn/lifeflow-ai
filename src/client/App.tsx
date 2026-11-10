import { Navigate, Route, Routes } from "react-router-dom";
import { useStore } from "./lib/store";
import { Layout } from "./components/Layout";
import { Toasts } from "./components/Toasts";
import { DashboardPage } from "./pages/Dashboard";
import { CalendarPage } from "./pages/Calendar";
import { HabitsPage } from "./pages/Habits";
import { GoalsPage } from "./pages/Goals";
import { StatsPage } from "./pages/Stats";
import { AssistantPage } from "./pages/Assistant";
import { SettingsPage } from "./pages/Settings";

export function App() {
  const { loading } = useStore();
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Yükleniyor…</div>;
  }
  return (
    <>
      <Layout>
        <Routes>
          <Route index element={<DashboardPage />} />
          <Route path="takvim" element={<CalendarPage />} />
          <Route path="aliskanliklar" element={<HabitsPage />} />
          <Route path="hedefler" element={<GoalsPage />} />
          <Route path="istatistik" element={<StatsPage />} />
          <Route path="asistan" element={<AssistantPage />} />
          <Route path="ayarlar" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      <Toasts />
    </>
  );
}
