import { readFileSync } from "node:fs";
import net from "node:net";
import { readConfig } from "../src/server/config";

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    out[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return out;
}

function sendMail(host: string, port: number, subject: string) {
  const body = [
    `Subject: ${subject}`,
    "From: env-probe@localhost",
    "To: inbox@localhost",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Local environment probe. This message stays in Mailpit.",
    "",
  ].join("\r\n");
  const commands = [
    "EHLO localhost",
    "MAIL FROM:<env-probe@localhost>",
    "RCPT TO:<inbox@localhost>",
    "DATA",
  ];
  return new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host, port });
    let buffer = "";
    let stage = 0;
    const fail = (message: string) => {
      socket.destroy();
      reject(new Error(message));
    };
    socket.setTimeout(8000, () => fail("SMTP 超时"));
    socket.on("error", (error) => reject(error));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines.at(-1) ?? "";
      if (/^\d{3}-/.test(last)) return;
      buffer = "";
      const code = Number(last.slice(0, 3));
      if (stage === 0) {
        if (code !== 220) return fail(`SMTP 问候失败：${code}`);
        stage = 1;
        socket.write(`${commands[0]}\r\n`);
        return;
      }
      if (stage >= 1 && stage <= 3) {
        if (code >= 400) return fail(`SMTP 命令失败：${code}`);
        socket.write(`${commands[stage]}\r\n`);
        stage += 1;
        return;
      }
      if (stage === 4) {
        if (code !== 354) return fail(`SMTP DATA 失败：${code}`);
        socket.write(`${body.replace(/^\./gm, "..")}\r\n.\r\n`);
        stage = 5;
        return;
      }
      if (stage === 5) {
        if (code !== 250) return fail(`SMTP 收信失败：${code}`);
        socket.write("QUIT\r\n");
        stage = 6;
        return;
      }
      socket.end();
      resolve();
    });
  });
}

const config = readConfig(loadEnvFile(".env.local"));
if (config.MAIL_TRANSPORT !== "smtp") {
  console.error("当前配置没有启用 SMTP。");
  process.exit(1);
}
const subject = `baby-plan-env-probe-${Date.now()}`;
await sendMail(config.SMTP_HOST, config.SMTP_PORT, subject);
const response = await fetch(new URL("/api/v1/messages", config.MAILPIT_URL));
if (!response.ok) {
  console.error(`Mailpit 收件箱接口返回 ${response.status}`);
  process.exit(1);
}
const inbox = (await response.json()) as { messages?: Array<{ Subject?: string }> };
const found = inbox.messages?.some((message) => message.Subject === subject) ?? false;
if (!found) {
  console.error("SMTP 已接受邮件，但 Mailpit 收件箱里没有对应主题。");
  process.exit(1);
}
console.log(`Mailpit 已收到测试邮件，主题 ${subject}`);
