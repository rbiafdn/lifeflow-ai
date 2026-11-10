// Uygulama geneli durum: profil, ayarlar, kategoriler, tema, bildirimler (toast).

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { CategoryDTO, SettingsDTO } from "@shared/types";

export interface User {
  id: string;
  name: string;
  email: string;
}

type Theme = "system" | "light" | "dark";

interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

interface Store {
  user: User | null;
  loading: boolean;
  settings: SettingsDTO | null;
  categories: CategoryDTO[];
  theme: Theme;
  toasts: Toast[];
  setUser: (u: User | null) => void;
  setTheme: (t: Theme) => void;
  refreshSettings: () => Promise<void>;
  refreshCategories: () => Promise<void>;
  toast: (text: string, kind?: Toast["kind"]) => void;
  categoryById: (id: string | null | undefined) => CategoryDTO | undefined;
}

const Ctx = createContext<Store | null>(null);

function readTheme(): Theme {
  try {
    return (localStorage.getItem("lifeflow-theme") as Theme) || "system";
  } catch {
    return "system";
  }
}

export function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("lifeflow-theme", t);
  } catch {
    /* yok say */
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);

  const refreshSettings = useCallback(async () => {
    const r = await api.get<{ settings: SettingsDTO }>("/api/settings");
    setSettings(r.settings);
  }, []);

  const refreshCategories = useCallback(async () => {
    const r = await api.get<{ categories: CategoryDTO[] }>("/api/categories");
    setCategories(r.categories);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<{ user: User }>("/api/auth/me");
        setUser(r.user);
        await Promise.all([refreshSettings(), refreshCategories()]);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshSettings, refreshCategories]);

  const value = useMemo<Store>(
    () => ({
      user,
      loading,
      settings,
      categories,
      theme,
      toasts,
      setUser,
      setTheme: (t) => setThemeState(t),
      refreshSettings,
      refreshCategories,
      toast,
      categoryById: (id) => categories.find((c) => c.id === id),
    }),
    [user, loading, settings, categories, theme, toasts, refreshSettings, refreshCategories, toast],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider eksik");
  return s;
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return "Beklenmeyen hata";
}
