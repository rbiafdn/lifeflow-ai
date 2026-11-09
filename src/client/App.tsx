import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useStore } from "./lib/store";
import { Layout } from "./components/Layout";
import { Toasts } from "./components/Toasts";
import { LoginPage, RegisterPage } from "./pages/Auth";
import { DashboardPage } from "./pages/Dashboard";
import { CalendarPage } from "./pages/Calendar";
import { HabitsPage } from "./pages/Habits";
import { GoalsPage } from "./pages/Goals";
import { StatsPage } from "./pages/Stats";
import { AssistantPage } from "./pages/Assistant";
import { SettingsPage } from "./pages/Settings";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useStore();
  const loc = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Yükleniyor…
      </div>
    );
  }
  if (!user) return <Navigate to="/giris" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}

export function App() {
  const { user, loading } = useStore();
  return (
    <>
      <Routes>
        <Route path="/giris" element={!loading && user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/kayit" element={!loading && user ? <Navigate to="/" replace /> : <RegisterPage />} />
        <Route
          path="/*"
          element={
            <Protected>
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
            </Protected>
          }
        />
      </Routes>
      <Toasts />
    </>
  );
}
