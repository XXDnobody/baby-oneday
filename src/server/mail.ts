import nodemailer from "nodemailer";
import { readConfig } from "./config";
import { AppError } from "./errors";

export async function sendMail(to: string, subject: string, text: string) {
  const config = readConfig();
  if (config.APP_ENV === "production" || config.MAIL_TRANSPORT !== "smtp") {
    throw new AppError("DEPENDENCY_UNAVAILABLE", "邮件服务尚未配置，请稍后重试。", 503);
  }
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST, port: config.SMTP_PORT, secure: false,
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 8000,
    ignoreTLS: true,
  });
  try {
    await transport.sendMail({ from: "宝宝计划 <baby-plan@localhost>", to, subject, text });
  } catch {
    throw new AppError("DEPENDENCY_UNAVAILABLE", "邮件发送失败，请稍后重新申请。", 503);
  } finally { transport.close(); }
}
