import { z } from "zod";

const schema = z.object({
  APP_ENV: z.enum(["local", "production", "test"]).default("local"),
  APP_URL: z.url().default("http://127.0.0.1:3000"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be generated before starting the app"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL must be a PostgreSQL connection URL"),
  MAIL_TRANSPORT: z.enum(["smtp", "disabled"]).default("smtp"),
  SMTP_HOST: z.string().min(1).default("127.0.0.1"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAILPIT_URL: z.url().default("http://127.0.0.1:8025"),
});

function databaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  return url;
}

function loopback(hostname: string) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

export type Config = ReturnType<typeof readConfig>;
export function readConfig(env: Record<string, string | undefined> = process.env) {
  const c = schema.parse(env);
  const url = new URL(c.APP_URL);
  const db = databaseUrl(c.DATABASE_URL);
  if (c.APP_ENV === "production") {
    if (url.protocol !== "https:" || c.MAIL_TRANSPORT !== "smtp" || loopback(c.SMTP_HOST)) {
      throw new Error("Production requires PostgreSQL, HTTPS, and a non-local email transport");
    }
  } else {
    if (!loopback(url.hostname)) throw new Error("Local and test modes must use a loopback URL");
    if (!loopback(db.hostname)) throw new Error("Local and test databases must use a loopback host");
    if (c.MAIL_TRANSPORT === "smtp" && !loopback(c.SMTP_HOST)) {
      throw new Error("Local mail must use the loopback Mailpit SMTP host");
    }
    const expected = c.APP_ENV === "test"
      ? { port: "5433", name: "/baby_plan_test", user: "baby_plan_test" }
      : { port: "5432", name: "/baby_plan_dev", user: "baby_plan_dev" };
    const actualUser = decodeURIComponent(db.username);
    if (db.port !== expected.port || db.pathname !== expected.name || actualUser !== expected.user) {
      throw new Error(c.APP_ENV === "test"
        ? "Test mode must use user baby_plan_test and database baby_plan_test on 127.0.0.1:5433"
        : "Local mode must use user baby_plan_dev and database baby_plan_dev on 127.0.0.1:5432");
    }
  }
  return { ...c, origin: url.origin };
}

export const limits = {
  codeMinutes: 10,
  ticketMinutes: 10,
  resetMinutes: 10,
  resendSeconds: 60,
  codeAttempts: 5,
  sessionHours: 12,
  rememberedIdleDays: 30,
  rememberedMaxDays: 90,
  inviteDays: 7,
};
