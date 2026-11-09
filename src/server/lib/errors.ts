export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what = "Kayıt") => new HttpError(404, `${what} bulunamadı.`);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const unauthorized = (msg = "Giriş yapmanız gerekiyor.") => new HttpError(401, msg);
export const forbidden = (msg = "Bu işlem için yetkiniz yok.") => new HttpError(403, msg);
