import "server-only";
import nodemailer from "nodemailer";
import { serverEnv } from "./env";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

export type MailOutcome = "sent" | "not_configured" | "failed";

/**
 * Transactional mail from the app (FR-8.3; ADR-028). Uses SMTP_URL when set; otherwise the
 * caller offers a prepared mailto: link. Never logs addresses or bodies.
 */
export async function sendMail(mail: OutgoingMail): Promise<MailOutcome> {
  const env = serverEnv();
  if (!env.SMTP_URL || !env.MAIL_FROM) return "not_configured";
  try {
    await nodemailer.createTransport(env.SMTP_URL).sendMail({ from: env.MAIL_FROM, ...mail });
    return "sent";
  } catch {
    return "failed";
  }
}
