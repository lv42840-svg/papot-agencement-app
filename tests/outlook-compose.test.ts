import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildOutlookComposeUrl,
  normalizeOutlookComposeInput,
  openOutlookDraft,
}: {
  buildOutlookComposeUrl: (input: {
    to: string;
    subject: string;
    body: string;
    attachmentPath?: string;
  }) => string;
  normalizeOutlookComposeInput: (input: unknown) => {
    to: string;
    subject: string;
    body: string;
    attachmentPath: string;
  };
  openOutlookDraft: (
    input: {
      to: string;
      subject: string;
      body: string;
      attachmentPath: string;
    },
    deps: {
      platform: string;
      execFile: (
        executable: string,
        args: string[],
        options: { env: Record<string, string | undefined> },
        callback: (error: Error | null) => void,
      ) => unknown;
      openExternal: (url: string) => Promise<void>;
    },
  ) => Promise<{
    ok: true;
    method: "CLASSIC_OUTLOOK" | "OUTLOOK_PROTOCOL";
    attachmentAttached: boolean;
  }>;
} = require("../desktop/outlook-compose.cjs");

const input = {
  to: "client@example.com",
  subject: "Devis D-2026-0042 - Accueil",
  body: "Bonjour,\n\nVeuillez trouver ci-joint notre devis.",
  attachmentPath: "C:\\PAPOT\\Commercial\\2026\\Client\\Devis\\devis.pdf",
};

describe("desktop Outlook compose", () => {
  it("construit un lien Outlook direct sans exposer de pièce jointe dans l'URL", () => {
    const url = buildOutlookComposeUrl(input);

    expect(url).toContain("ms-outlook://compose?");
    expect(url).toContain("to=client%40example.com");
    expect(url).toContain("subject=Devis+");
    expect(url).not.toContain("attachment");
    expect(url).not.toContain("PAPOT");
  });

  it("utilise Outlook classique pour ouvrir un brouillon avec le PDF joint", async () => {
    const openExternal = vi.fn(async () => undefined);
    const execFile = vi.fn(
      (
        _executable: string,
        _args: string[],
        options: { env: Record<string, string | undefined> },
        callback: (error: Error | null) => void,
      ) => {
        expect(options.env.PAPOT_OUTLOOK_TO).toBe("client@example.com");
        expect(options.env.PAPOT_OUTLOOK_SUBJECT).toContain("D-2026-0042");
        expect(options.env.PAPOT_OUTLOOK_ATTACHMENT).toBe(input.attachmentPath);
        callback(null);
      },
    );

    const result = await openOutlookDraft(input, {
      platform: "win32",
      execFile,
      openExternal,
    });

    expect(result).toEqual({
      ok: true,
      method: "CLASSIC_OUTLOOK",
      attachmentAttached: true,
    });
    expect(execFile).toHaveBeenCalledOnce();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("repasse par le protocole Outlook si l'automatisation classique n'est pas disponible", async () => {
    const opened: string[] = [];
    const result = await openOutlookDraft(input, {
      platform: "win32",
      execFile: (_executable, _args, _options, callback) => callback(new Error("COM unavailable")),
      openExternal: async (url) => {
        opened.push(url);
      },
    });

    expect(result).toEqual({
      ok: true,
      method: "OUTLOOK_PROTOCOL",
      attachmentAttached: false,
    });
    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain("ms-outlook://compose?");
  });

  it("refuse une composition sans objet", () => {
    expect(() =>
      normalizeOutlookComposeInput({ to: "", subject: "", body: "", attachmentPath: "" }),
    ).toThrow("OUTLOOK_COMPOSE_INVALID");
  });
});
