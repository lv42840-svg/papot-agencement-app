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

function isEmail(valeur: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valeur);
}

function readAddress(valeur: string | undefined, fallback: string): string {
  const normalized = valeur?.trim() || fallback;
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
  const username = env.PAPOT_SMTP_USERNAME?.trim() || env.PAPOT_SMTP_USER?.trim() || "";
  const password = env.PAPOT_SMTP_PASSWORD ?? "";
  const portRaw = env.PAPOT_SMTP_PORT?.trim() || "587";
  const port = Number(portRaw);
  const secure = (env.PAPOT_SMTP_SECURE?.trim() || "false").toLowerCase() === "true";

  if (!host || !username || !password || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("QUOTE_EMAIL_NOT_CONFIGURED");
  }

  return { host, port, secure, username, password };
}

function headerValue(valeur: string): string {
  if (/\r|\n/.test(valeur)) throw new Error("QUOTE_EMAIL_SEND_FAILED");
  return valeur.trim();
}

function encodeHeader(valeur: string): string {
  return `=?UTF-8?B?${Buffer.from(headerValue(valeur), "utf8").toString("base64")}?=`;
}

function base64Lines(valeur: Uint8Array | string): string {
  const encoded = Buffer.from(
    valeur instanceof Uint8Array ? valeur : Buffer.from(valeur, "utf8"),
  ).toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function asciiFileName(valeur: string): string {
  const normalized = valeur
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "devis.pdf";
}

export function buildQuoteEmailMessage(
  saisie: QuoteEmailInput,
  policy: QuoteEmailPolicy,
): {
  envelopeFrom: string;
  recipients: string[];
  raw: string;
  subject: string;
  body: string;
} {
  const to = saisie.to.trim();
  if (!isEmail(to)) throw new Error("QUOTE_RECIPIENT_EMAIL_REQUIRED");
  if (saisie.pdfBytes.byteLength === 0) throw new Error("QUOTE_EMAIL_SEND_FAILED");

  const subject = headerValue(saisie.subject);
  const corps = saisie.body.trim();
  if (!subject || !corps) throw new Error("QUOTE_EMAIL_CONTENT_REQUIRED");

  const boundary = `papot-${randomUUID()}`;
  const domain = policy.fromEmail.split("@")[1] || "papot.app";
  const fileName = headerValue(saisie.pdfFileName);
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
    base64Lines(corps),
    "",
    `--${boundary}`,
    `Content-Type: application/pdf; name="${fallbackFileName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodeURIComponent(
      fileName,
    )}`,
    "",
    base64Lines(saisie.pdfBytes),
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return {
    envelopeFrom: policy.fromEmail,
    recipients: Array.from(new Set([to, policy.ccEmail])),
    raw,
    subject,
    body: corps,
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
      const lignes = buffer.split("\r\n").filter(Boolean);
      const last = lignes[lignes.length - 1] ?? "";
      if (/^\d{3} /.test(last)) {
        cleanup();
        resolve(buffer);
      }
    };

    const onError = (erreur: Error) => {
      cleanup();
      reject(erreur);
    };

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function command(socket: net.Socket, ligne: string, attendu: number[]): Promise<string> {
  socket.write(ligne + "\r\n");
  const reponse = await readResponse(socket);
  const code = Number(reponse.slice(0, 3));
  if (!attendu.includes(code)) throw new Error(`SMTP_${code}_${reponse.trim()}`);
  return reponse;
}

async function connectSocket(configuration: SmtpConfig): Promise<net.Socket> {
  if (configuration.secure) {
    return await new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host: configuration.host,
          port: configuration.port,
          servername: configuration.host,
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
    const socket = net.connect({ host: configuration.host, port: configuration.port }, () =>
      resolve(socket),
    );
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
        servername: configuration.host,
        rejectUnauthorized: true,
      },
      () => resolve(secure),
    );
    secure.setTimeout(20_000);
    secure.once("error", reject);
    secure.once("timeout", () => secure.destroy(new Error("SMTP_TIMEOUT")));
  });
}

async function sendSmtpMessage(parametres: {
  config: SmtpConfig;
  envelopeFrom: string;
  recipients: string[];
  raw: string;
}) {
  const socket = await connectSocket(parametres.config);

  try {
    if (parametres.config.secure) await readResponse(socket);

    await command(socket, "EHLO papot.app", [250]);
    await command(socket, "AUTH LOGIN", [334]);
    await command(socket, Buffer.from(parametres.config.username, "utf8").toString("base64"), [
      334,
    ]);
    await command(socket, Buffer.from(parametres.config.password, "utf8").toString("base64"), [
      235,
    ]);
    await command(socket, `MAIL FROM:<${parametres.envelopeFrom}>`, [250]);

    for (const recipient of parametres.recipients) {
      await command(socket, `RCPT TO:<${recipient}>`, [250, 251]);
    }

    await command(socket, "DATA", [354]);
    socket.write(dotStuff(parametres.raw) + "\r\n.\r\n");
    const sent = await readResponse(socket);
    const code = Number(sent.slice(0, 3));
    if (code !== 250) throw new Error(`SMTP_${code}_${sent.trim()}`);

    await command(socket, "QUIT", [221]).catch(() => undefined);
  } finally {
    socket.end();
  }
}

export async function sendQuoteEmail(
  saisie: QuoteEmailInput,
  policy: QuoteEmailPolicy,
  env: QuoteEmailEnv = process.env,
): Promise<void> {
  const message = buildQuoteEmailMessage(saisie, policy);
  const configuration = smtpConfigFromEnv(env);

  try {
    await sendSmtpMessage({
      config: configuration,
      envelopeFrom: message.envelopeFrom,
      recipients: message.recipients,
      raw: message.raw,
    });
  } catch (erreur) {
    if (erreur instanceof Error && erreur.message === "QUOTE_EMAIL_NOT_CONFIGURED") throw erreur;
    throw new Error("QUOTE_EMAIL_SEND_FAILED");
  }
}
