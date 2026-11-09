// Küçük fetch sarmalayıcı. Çerez tabanlı oturum kullanır.

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String((data as { error: string }).error) : `İstek başarısız (${res.status})`;
    throw new ApiError(res.status, msg, typeof data === "object" ? (data as { details?: unknown }).details : undefined);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => call<T>("GET", url),
  post: <T>(url: string, body?: unknown) => call<T>("POST", url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => call<T>("PATCH", url, body ?? {}),
  put: <T>(url: string, body?: unknown) => call<T>("PUT", url, body ?? {}),
  delete: <T>(url: string, body?: unknown) => call<T>("DELETE", url, body),
};
