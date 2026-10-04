import { randomUUID } from "node:crypto";
import { once } from "node:events";
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

type SmtpResponse = {
  code: number;
  lines: string[];
};

type ResponseWaiter = {
  resolve: (response: SmtpResponse) => void;
  reject: (error: Error) => void;
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

class SmtpResponseReader {
  private buffer = "";
  private currentCode: number | null = null;
  private currentLines: string[] = [];
  private responses: SmtpResponse[] = [];
  private waiters: ResponseWaiter[] = [];
  private failure: Error | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string | Buffer) => this.consume(String(chunk)));
    socket.on("error", (error) => this.fail(error instanceof Error ? error : new Error("SMTP")));
    socket.on("timeout", () => socket.destroy(new Error("SMTP_TIMEOUT")));
    socket.on("close", () => {
      if (this.waiters.length > 0) this.fail(new Error("SMTP_CONNECTION_CLOSED"));
    });
  }

  read(): Promise<SmtpResponse> {
    if (this.responses.length > 0) return Promise.resolve(this.responses.shift()!);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<SmtpResponse>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  private consume(chunk: string) {
    this.buffer += chunk;
    while (true) {
      const lineEnd = this.buffer.indexOf("\n");
      if (lineEnd < 0) return;
      const line = this.buffer.slice(0, lineEnd).replace(/\r$/, "");
      this.buffer = this.buffer.slice(lineEnd + 1);
      this.consumeLine(line);
    }
  }

  private consumeLine(line: string) {
    const match = /^(\d{3})([ -])(.*)$/.exec(line);
    if (!match) return;

    const code = Number(match[1]);
    if (this.currentCode === null) this.currentCode = code;
    this.currentLines.push(line);

    if (match[2] !== " ") return;

    const response: SmtpResponse = {
      code: this.currentCode ?? code,
      lines: this.currentLines.slice(),
    };
    this.currentCode = null;
    this.currentLines = [];

    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(response);
    else this.responses.push(response);
  }

  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }
}

function assertResponse(response: SmtpResponse, expected: readonly number[]) {
  if (!expected.includes(response.code)) throw new Error(`SMTP_RESPONSE_${response.code}`);
}

async function writeSocket(socket: net.Socket, value: string) {
  if (!socket.write(value, "utf8")) await once(socket, "drain");
}

async function smtpCommand(
  socket: net.Socket,
  reader: SmtpResponseReader,
  command: string,
  expected: readonly number[],
) {
  await writeSocket(socket, `${command}\r\n`);
  const response = await reader.read();
  assertResponse(response, expected);
  return response;
}

function dotStuff(raw: string): string {
  return raw.replace(/\r?\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..");
}

async function connectSmtp(config: SmtpConfig): Promise<{
  socket: net.Socket;
  reader: SmtpResponseReader;
}> {
  if (config.secure) {
    const socket = tls.connect({
      host: config.host,
      port: config.port,
      servername: config.host,
      rejectUnauthorized: true,
    });
    socket.setTimeout(20_000);
    const reader = new SmtpResponseReader(socket);
    await once(socket, "secureConnect");
    assertResponse(await reader.read(), [220]);
    return { socket, reader };
  }

  const plain = net.connect({ host: config.host, port: config.port });
  plain.setTimeout(20_000);
  const plainReader = new SmtpResponseReader(plain);
  await once(plain, "connect");
  assertResponse(await plainReader.read(), [220]);
  await smtpCommand(plain, plainReader, "EHLO papot.app", [250]);
  await smtpCommand(plain, plainReader, "STARTTLS", [220]);

  const socket = tls.connect({
    socket: plain,
    servername: config.host,
    rejectUnauthorized: true,
  });
  socket.setTimeout(20_000);
  const reader = new SmtpResponseReader(socket);
  await once(socket, "secureConnect");
  return { socket, reader };
}

async function sendSmtpMessage(params: {
  config: SmtpConfig;
  envelopeFrom: string;
  recipients: string[];
  raw: string;
}) {
  const { socket, reader } = await connectSmtp(params.config);

  try {
    await smtpCommand(socket, reader, "EHLO papot.app", [250]);
    await smtpCommand(socket, reader, "AUTH LOGIN", [334]);
    await smtpCommand(
      socket,
      reader,
      Buffer.from(params.config.username, "utf8").toString("base64"),
      [334],
    );
    await smtpCommand(
      socket,
      reader,
      Buffer.from(params.config.password, "utf8").toString("base64"),
      [235],
    );
    await smtpCommand(socket, reader, `MAIL FROM:<${params.envelopeFrom}>`, [250]);

    for (const recipient of params.recipients) {
      await smtpCommand(socket, reader, `RCPT TO:<${recipient}>`, [250, 251]);
    }

    await smtpCommand(socket, reader, "DATA", [354]);
    await writeSocket(socket, `${dotStuff(params.raw)}\r\n.\r\n`);
    assertResponse(await reader.read(), [250]);
    await smtpCommand(socket, reader, "QUIT", [221]).catch(() => undefined);
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
