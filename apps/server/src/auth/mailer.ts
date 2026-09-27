import type { FastifyBaseLogger } from 'fastify';
import nodemailer from 'nodemailer';
import type { Env } from '../env';

export interface Mailer {
  /** Whether mail actually leaves the server. When false, messages are only logged. */
  readonly delivers: boolean;
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

export function createMailer(env: Env, log: FastifyBaseLogger): Mailer {
  if (!env.SMTP_URL) {
    return {
      delivers: false,
      async send({ to, subject, text }) {
        log.info({ to, subject }, 'SMTP_URL is not set; logging email instead of sending');
        console.log(`\n--- email to ${to}: ${subject}\n${text}\n---\n`);
      },
    };
  }
  const transport = nodemailer.createTransport(env.SMTP_URL);
  return {
    delivers: true,
    async send({ to, subject, text }) {
      await transport.sendMail({ from: env.MAIL_FROM, to, subject, text });
    },
  };
}
