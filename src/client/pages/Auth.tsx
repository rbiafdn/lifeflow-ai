import { useState, type FormEvent } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { useStore, errorText, type User } from "../lib/store";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/30">
            <Sparkles size={22} />
          </div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        <div className="card p-5">{children}</div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { setUser } = useStore();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ user: User }>("/api/auth/login", { email, password });
      setUser(r.user);
      nav((loc.state as { from?: string })?.from ?? "/", { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="LifeFlow AI" subtitle="Hesabına giriş yap">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">E-posta</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        <div>
          <label className="label">Şifre</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Giriş yapılıyor…" : "Giriş yap"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        Hesabın yok mu?{" "}
        <Link to="/kayit" className="font-medium text-brand-600 hover:underline">
          Kayıt ol
        </Link>
      </p>
    </Shell>
  );
}

export function RegisterPage() {
  const { setUser } = useStore();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ user: User }>("/api/auth/register", { name, email, password });
      setUser(r.user);
      nav("/", { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Hesap oluştur" subtitle="Birkaç saniye sürer">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Ad</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </div>
        <div>
          <label className="label">E-posta</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        <div>
          <label className="label">Şifre (en az 8 karakter)</label>
          <input className="input" type="password" value={password} minLength={8} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Oluşturuluyor…" : "Kayıt ol"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        Zaten hesabın var mı?{" "}
        <Link to="/giris" className="font-medium text-brand-600 hover:underline">
          Giriş yap
        </Link>
      </p>
    </Shell>
  );
}
