import type { ZodType } from "zod";
import { badRequest } from "./errors";

/** Zod şemasıyla doğrular; hata varsa 400 fırlatır. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(kök)"}: ${i.message}`);
    throw badRequest("Geçersiz veri: " + issues.join("; "), issues);
  }
  return result.data;
}
