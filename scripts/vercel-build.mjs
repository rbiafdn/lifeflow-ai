// Vercel derlemesi: Prisma client üret, DATABASE_URL varsa migrasyonları uygula, istemciyi derle.
import { execSync } from "node:child_process";

const run = (cmd) => {
  console.log("> " + cmd);
  execSync(cmd, { stdio: "inherit" });
};

run("npx prisma generate");
if (process.env.DATABASE_URL) {
  run("npx prisma migrate deploy");
} else {
  console.warn("UYARI: DATABASE_URL tanımlı değil; migrasyon atlandı. Uygulama veritabanı olmadan çalışmaz.");
}
run("npx vite build");
