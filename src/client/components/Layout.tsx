import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, CalendarDays, Repeat, Target, BarChart3, Sparkles, Settings, LogOut, Sun, Moon, Monitor } from "lucide-react";
import { useStore } from "../lib/store";

const NAV = [
  { to: "/", label: "Bugün", icon: LayoutDashboard, end: true },
  { to: "/takvim", label: "Takvim", icon: CalendarDays },
  { to: "/asistan", label: "Asistan", icon: Sparkles },
  { to: "/aliskanliklar", label: "Alışkanlıklar", icon: Repeat },
  { to: "/hedefler", label: "Hedefler", icon: Target },
  { to: "/istatistik", label: "İstatistik", icon: BarChart3 },
  { to: "/ayarlar", label: "Ayarlar", icon: Settings },
];

const MOBILE_NAV = NAV.filter((n) => ["/", "/takvim", "/asistan", "/aliskanliklar", "/ayarlar"].includes(n.to));

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout, theme, setTheme } = useStore();
  const nav = useNavigate();
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const nextTheme = () => setTheme(theme === "system" ? "light" : theme === "light" ? "dark" : "system");

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-5 dark:border-slate-800 dark:bg-slate-900 md:flex md:sticky md:top-0 md:h-screen">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Sparkles size={16} />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">LifeFlow AI</div>
            <div className="text-[11px] text-slate-500">Kişisel yaşam asistanı</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                  isActive ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-200" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`
              }
            >
              <n.icon size={18} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
          <div className="flex items-center justify-between px-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{user?.name}</div>
              <div className="truncate text-[11px] text-slate-500">{user?.email}</div>
            </div>
            <div className="flex items-center gap-1">
              <button className="btn-ghost p-2" title="Tema" onClick={nextTheme}>
                <ThemeIcon size={16} />
              </button>
              <button
                className="btn-ghost p-2"
                title="Çıkış"
                onClick={async () => {
                  await logout();
                  nav("/giris");
                }}
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 pb-20 md:pb-0">
        <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-8 md:py-8">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 md:hidden">
        {MOBILE_NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${isActive ? "text-brand-600 dark:text-brand-300" : "text-slate-500"}`
            }
          >
            <n.icon size={20} />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
