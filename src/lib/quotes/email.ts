import { randomUUID } from "node:crypto";
import * as net from "node:net";
import * as tls from "node:tls";

export const DEFAULT_QUOTE_FROM_EMAIL = "noreply@papot.app";
export const DEFAULT_QUOTE_CC_EMAIL = "contact@papot.eu";
export const DEFAULT_QUOTE_REPLY_TO_EMAIL = "contact@papot.eu";

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
};

export type QuoteEmailInput = {
  to: string;
  subject: string;
  body: string;
  pdfFileName: string;
  pdfBytes: Uint8Array;
};

export type QuoteEmailPolicy = {
  fromEmail: string;
  ccEmail: string;
  replyToEmail: string;
};

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function readAddress(value: string | undefined, fallback: string): string {
  const normalized = value?.trim() || fallback;
  if (!isEmail(normalized)) throw new Error("QUOTE_EMAIL_NOT_CONFIGURED");
  return normalized;
}

type QuoteEmailEnv = Record<string, string | undefined>;

export function quoteEmailPolicyFromEnv(env: QuoteEmailEnv = process.env): QuoteEmailPolicy {
  return {
    fromEmail: readAddress(env.PAPOT_QUOTE_FROM_EMAIL, DEFAULT_QUOTE_FROM_EMAIL),
    ccEmail: readAddress(env.PAPOT_QUOTE_CC_EMAIL, DEFAULT_QUOTE_CC_EMAIL),
    replyToEmail: readAddress(env.PAPOT_QUOTE_REPLY_TO_EMAIL, DEFAULT_QUOTE_REPLY_TO_EMAIL),
  };
}

function smtpConfigFromEnv(env: QuoteEmailEnv = process.env): SmtpConfig {
  const host = env.PAPOT_SMTP_HOST?.trim() ?? "";
  const username =
    env.PAPOT_SMTP_USERNAME?.trim() || env.PAPOT_SMTP_USER?.trim() || "";
  const password = env.PAPOT_SMTP_PASSWORD ?? "";
  const portRaw = env.PAPOT_SMTP_PORT?.trim() || "587";
  const port = Number(portRaw);
  const secure = (env.PAPOT_SMTP_SECURE?.trim() || "false").toLowerCase() === "true";

  if (
    !host ||
    !username ||
    !password ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("QUOTE_EMAIL_NOT_CONFIGURED");
  }

  return { host, port, secure, username, password };
}

function headerValue(value: string): string {
  if (/\r|\n/.test(value)) throw new Error("QUOTE_EMAIL_SEND_FAILED");
  return value.trim();
}

function encodeHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(headerValue(value), "utf8").toString("base64")}?=`;
}

function base64Lines(value: Uint8Array | string): string {
  const encoded = Buffer.from(
    value instanceof Uint8Array ? value : Buffer.from(value, "utf8"),
  ).toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function asciiFileName(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "devis.pdf";
}

export function buildQuoteEmailMessage(
  input: QuoteEmailInput,
  policy: QuoteEmailPolicy,
): {
  envelopeFrom: string;
  recipients: string[];
  raw: string;
  subject: string;
  body: string;
} {
  const to = input.to.trim();
  if (!isEmail(to)) throw new Error("QUOTE_RECIPIENT_EMAIL_REQUIRED");
  if (input.pdfBytes.byteLength === 0) throw new Error("QUOTE_EMAIL_SEND_FAILED");

  const subject = headerValue(input.subject);
  const body = input.body.trim();
  if (!subject || !body) throw new Error("QUOTE_EMAIL_CONTENT_REQUIRED");

  const boundary = `papot-${randomUUID()}`;
  const domain = policy.fromEmail.split("@")[1] || "papot.app";
  const fileName = headerValue(input.pdfFileName);
  const fallbackFileName = asciiFileName(fileName);

  const raw = [
    `From: PAPOT AGENCEMENT <${policy.fromEmail}>`,
    `To: ${to}`,
    `Cc: ${policy.ccEmail}`,
    `Reply-To: ${policy.replyToEmail}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(body),
    "",
    `--${boundary}`,
    `Content-Type: application/pdf; name="${fallbackFileName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodeURIComponent(
      fileName,
    )}`,
    "",
    base64Lines(input.pdfBytes),
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return {
    envelopeFrom: policy.fromEmail,
    recipients: Array.from(new Set([to, policy.ccEmail])),
    raw,
    subject,
    body,
  };
}

function dotStuff(raw: string): string {
  return raw.replace(/\r?\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..");
}

function readResponse(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n").filter(Boolean);
      const last = lines[lines.length - 1] ?? "";
      if (/^\d{3} /.test(last)) {
        cleanup();
        resolve(buffer);
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function command(
  socket: net.Socket,
  line: string,
  expected: number[],
): Promise<string> {
  socket.write(line + "\r\n");
  const response = await readResponse(socket);
  const code = Number(response.slice(0, 3));
  if (!expected.includes(code)) throw new Error(`SMTP_${code}_${response.trim()}`);
  return response;
}

async function connectSocket(config: SmtpConfig): Promise<net.Socket> {
  if (config.secure) {
    return await new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host: config.host,
          port: config.port,
          servername: config.host,
          rejectUnauthorized: true,
        },
        () => resolve(socket),
      );
      socket.setTimeout(20_000);
      socket.once("error", reject);
      socket.once("timeout", () => socket.destroy(new Error("SMTP_TIMEOUT")));
    });
  }

  const plain = await new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect({ host: config.host, port: config.port }, () => resolve(socket));
    socket.setTimeout(20_000);
    socket.once("error", reject);
    socket.once("timeout", () => socket.destroy(new Error("SMTP_TIMEOUT")));
  });

  await readResponse(plain);
  await command(plain, "EHLO papot.app", [250]);
  await command(plain, "STARTTLS", [220]);

  return await new Promise((resolve, reject) => {
    const secure = tls.connect(
      {
        socket: plain,
        servername: config.host,
        rejectUnauthorized: true,
      },
      () => resolve(secure),
    );
    secure.setTimeout(20_000);
    secure.once("error", reject);
    secure.once("timeout", () => secure.destroy(new Error("SMTP_TIMEOUT")));
  });
}

async function sendSmtpMessage(params: {
  config: SmtpConfig;
  envelopeFrom: string;
  recipients: string[];
  raw: string;
}) {
  const socket = await connectSocket(params.config);

  try {
    if (params.config.secure) await readResponse(socket);

    await command(socket, "EHLO papot.app", [250]);
    await command(socket, "AUTH LOGIN", [334]);
    await command(
      socket,
      Buffer.from(params.config.username, "utf8").toString("base64"),
      [334],
    );
    await command(
      socket,
      Buffer.from(params.config.password, "utf8").toString("base64"),
      [235],
    );
    await command(socket, `MAIL FROM:<${params.envelopeFrom}>`, [250]);

    for (const recipient of params.recipients) {
      await command(socket, `RCPT TO:<${recipient}>`, [250, 251]);
    }

    await command(socket, "DATA", [354]);
    socket.write(dotStuff(params.raw) + "\r\n.\r\n");
    const sent = await readResponse(socket);
    const code = Number(sent.slice(0, 3));
    if (code !== 250) throw new Error(`SMTP_${code}_${sent.trim()}`);

    await command(socket, "QUIT", [221]).catch(() => undefined);
  } finally {
    socket.end();
  }
}

export async function sendQuoteEmail(
  input: QuoteEmailInput,
  policy: QuoteEmailPolicy,
  env: QuoteEmailEnv = process.env,
): Promise<void> {
  const message = buildQuoteEmailMessage(input, policy);
  const config = smtpConfigFromEnv(env);

  try {
    await sendSmtpMessage({
      config,
      envelopeFrom: message.envelopeFrom,
      recipients: message.recipients,
      raw: message.raw,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "QUOTE_EMAIL_NOT_CONFIGURED") throw error;
    throw new Error("QUOTE_EMAIL_SEND_FAILED");
  }
}
