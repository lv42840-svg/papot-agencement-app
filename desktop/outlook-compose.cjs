"use strict";

const { execFile: defaultExecFile } = require("node:child_process");

const CLASSIC_OUTLOOK_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$outlook = New-Object -ComObject Outlook.Application",
  "$mail = $outlook.CreateItem(0)",
  "$mail.To = $env:PAPOT_OUTLOOK_TO",
  "$mail.Subject = $env:PAPOT_OUTLOOK_SUBJECT",
  "$mail.Display($false)",
  "Start-Sleep -Milliseconds 150",
  'if ($env:PAPOT_OUTLOOK_BODY) { $mail.Body = $env:PAPOT_OUTLOOK_BODY + "\`r\`n\`r\`n" + $mail.Body }',
  "if ($env:PAPOT_OUTLOOK_ATTACHMENT) { [void]$mail.Attachments.Add($env:PAPOT_OUTLOOK_ATTACHMENT) }",
].join("; ");

function cleanText(value, maxLength, errorCode) {
  if (typeof value !== "string") throw new Error(errorCode);
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (
    normalized.length > maxLength ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(normalized)
  ) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeOutlookComposeInput(rawInput) {
  if (!rawInput || typeof rawInput !== "object") throw new Error("OUTLOOK_COMPOSE_INVALID");
  const to = cleanText(rawInput.to ?? "", 1000, "OUTLOOK_COMPOSE_INVALID");
  const subject = cleanText(rawInput.subject ?? "", 500, "OUTLOOK_COMPOSE_INVALID");
  const body = cleanText(rawInput.body ?? "", 10_000, "OUTLOOK_COMPOSE_INVALID");
  const attachmentPath = cleanText(rawInput.attachmentPath ?? "", 4000, "OUTLOOK_COMPOSE_INVALID");
  if (!subject) throw new Error("OUTLOOK_COMPOSE_INVALID");
  return { to, subject, body, attachmentPath };
}

function buildOutlookComposeUrl(input) {
  const normalized = normalizeOutlookComposeInput(input);
  const params = new URLSearchParams();
  if (normalized.to) params.set("to", normalized.to);
  params.set("subject", normalized.subject);
  if (normalized.body) params.set("body", normalized.body);
  return `ms-outlook://compose?${params.toString()}`;
}

function execFilePromise(execFile, executable, args, options) {
  return new Promise((resolve, reject) => {
    execFile(executable, args, options, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function openOutlookDraft(
  rawInput,
  { platform = process.platform, execFile = defaultExecFile, openExternal },
) {
  const input = normalizeOutlookComposeInput(rawInput);

  if (platform === "win32") {
    try {
      await execFilePromise(
        execFile,
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          CLASSIC_OUTLOOK_SCRIPT,
        ],
        {
          windowsHide: true,
          env: {
            ...process.env,
            PAPOT_OUTLOOK_TO: input.to,
            PAPOT_OUTLOOK_SUBJECT: input.subject,
            PAPOT_OUTLOOK_BODY: input.body,
            PAPOT_OUTLOOK_ATTACHMENT: input.attachmentPath,
          },
        },
      );
      return {
        ok: true,
        method: "CLASSIC_OUTLOOK",
        attachmentAttached: Boolean(input.attachmentPath),
      };
    } catch {
      // New Outlook does not expose the classic COM automation surface.
      // Fall through to Microsoft's Outlook URI scheme.
    }
  }

  if (typeof openExternal !== "function") throw new Error("OUTLOOK_OPEN_FAILED");
  try {
    await openExternal(buildOutlookComposeUrl(input));
    return {
      ok: true,
      method: "OUTLOOK_PROTOCOL",
      attachmentAttached: false,
    };
  } catch {
    throw new Error("OUTLOOK_OPEN_FAILED");
  }
}

module.exports = {
  buildOutlookComposeUrl,
  normalizeOutlookComposeInput,
  openOutlookDraft,
};
