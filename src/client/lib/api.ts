// İstek sarmalayıcı: sunucu yoktur, çağrılar tarayıcı içi çekirdeğe (src/core/router) gider.

import { handle } from "../../core/router";
import { CoreError } from "../../core/db";

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function call<T>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: unknown): Promise<T> {
  try {
    // Veri aynı sekmede eşzamanlı değiştiğinde arayüzün takılmaması için mikro bekleme
    await Promise.resolve();
    return (await handle(method, url, body)) as T;
  } catch (e) {
    if (e instanceof CoreError) throw new ApiError(e.status, e.message, e.details);
    if (e instanceof Error) throw new ApiError(500, e.message);
    throw new ApiError(500, String(e));
  }
}

export const api = {
  get: <T>(url: string) => call<T>("GET", url),
  post: <T>(url: string, body?: unknown) => call<T>("POST", url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => call<T>("PATCH", url, body ?? {}),
  put: <T>(url: string, body?: unknown) => call<T>("PUT", url, body ?? {}),
  delete: <T>(url: string, body?: unknown) => call<T>("DELETE", url, body),
};

/** Dışa aktarma: çekirdekten gelen içeriği dosya olarak indirir. */
export async function downloadExport(url: string) {
  const r = await api.get<{ filename: string; type: string; content: string }>(url);
  const blob = new Blob([r.content], { type: r.type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = r.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
