import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type PdfCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type PdfCommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<PdfCommandResult>;

export type LibreOfficePdfConversionOptions = {
  binary?: string;
  timeoutMs?: number;
  commandRunner?: PdfCommandRunner;
};

export type MicrosoftWordPdfConversionOptions = {
  binary?: string;
  timeoutMs?: number;
  commandRunner?: PdfCommandRunner;
};

export type DocxPdfConversionOptions = LibreOfficePdfConversionOptions & {
  platform?: NodeJS.Platform;
  wordBinary?: string;
  wordCommandRunner?: PdfCommandRunner;
};

export type PdfRenderOptions = {
  binary?: string;
  dpi?: number;
  timeoutMs?: number;
  commandRunner?: PdfCommandRunner;
};

export type PdfVisualComparison = {
  matches: boolean;
  referencePageCount: number;
  actualPageCount: number;
  changedPages: number[];
  referencePageHashes: string[];
  actualPageHashes: string[];
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RENDER_DPI = 150;

function commandNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export function assertPdfBuffer(pdf: Uint8Array): void {
  const buffer = Buffer.from(pdf);
  if (buffer.length < 16 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("PDF_INVALID_HEADER");
  }
  const tail = buffer.subarray(Math.max(0, buffer.length - 4096)).toString("latin1");
  if (!tail.includes("%%EOF")) throw new Error("PDF_EOF_MISSING");
}

export const runPdfCommand: PdfCommandRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`PDF_COMMAND_TIMEOUT:${command}`));
    }, options.timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });

function libreOfficeCandidates(explicitBinary?: string): string[] {
  if (explicitBinary?.trim()) return [explicitBinary.trim()];
  if (process.env.PAPOT_LIBREOFFICE_BIN?.trim()) {
    return [process.env.PAPOT_LIBREOFFICE_BIN.trim()];
  }

  const candidates: string[] = [];
  if (process.platform === "win32") {
    candidates.push(
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    );
  }
  candidates.push("soffice", "libreoffice");
  return candidates;
}

function microsoftWordPowerShellCandidates(explicitBinary?: string): string[] {
  if (explicitBinary?.trim()) return [explicitBinary.trim()];
  if (process.env.PAPOT_POWERSHELL_BIN?.trim()) {
    return [process.env.PAPOT_POWERSHELL_BIN.trim()];
  }
  return [
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "powershell.exe",
    "pwsh.exe",
  ];
}

function isCommandUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("PDF_COMMAND_NOT_FOUND:");
}

const WORD_PDF_EXPORT_SCRIPT = `
$ErrorActionPreference = "Stop"
$inputPath = $args[0]
$outputPath = $args[1]
$word = $null
$document = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $document = $word.Documents.Open($inputPath)
  $document.ExportAsFixedFormat($outputPath, 17)
} finally {
  if ($null -ne $document) {
    $document.Close($false)
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
  }
  if ($null -ne $word) {
    $word.Quit()
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
  }
}
`;

async function runFirstAvailable(
  candidates: string[],
  args: string[],
  options: { cwd: string; timeoutMs: number; commandRunner: PdfCommandRunner },
): Promise<{ command: string; result: PdfCommandResult }> {
  let lastNotFound: unknown = null;
  for (const command of candidates) {
    try {
      const result = await options.commandRunner(command, args, {
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
      });
      return { command, result };
    } catch (error) {
      if (!commandNotFound(error)) throw error;
      lastNotFound = error;
    }
  }

  const unavailable = new Error(`PDF_COMMAND_NOT_FOUND:${candidates.join("|")}`);
  if (lastNotFound) (unavailable as Error & { cause?: unknown }).cause = lastNotFound;
  throw unavailable;
}

function commandMessage(result: PdfCommandResult): string {
  return result.stderr.trim() || result.stdout.trim() || "NO_COMMAND_OUTPUT";
}

export async function convertDocxToPdfWithLibreOffice(
  docx: Uint8Array,
  options: LibreOfficePdfConversionOptions = {},
): Promise<Uint8Array> {
  const workDir = await mkdtemp(path.join(tmpdir(), "papot-docx-pdf-"));
  const outputDir = path.join(workDir, "out");
  const profileDir = path.join(workDir, "libreoffice-profile");
  const inputPath = path.join(workDir, "quote.docx");
  const outputPath = path.join(outputDir, "quote.pdf");
  const commandRunner = options.commandRunner ?? runPdfCommand;

  try {
    await mkdir(outputDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    await writeFile(inputPath, docx);

    const args = [
      "--headless",
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      "--convert-to",
      "pdf",
      "--outdir",
      outputDir,
      inputPath,
    ];
    const { command, result } = await runFirstAvailable(
      libreOfficeCandidates(options.binary),
      args,
      {
        cwd: workDir,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        commandRunner,
      },
    );

    if (result.exitCode !== 0) {
      throw new Error(
        `PDF_CONVERSION_FAILED:${command}:${result.exitCode}:${commandMessage(result)}`,
      );
    }

    let pdf: Uint8Array;
    try {
      pdf = await readFile(outputPath);
    } catch {
      const outputFiles = await readdir(outputDir).catch(() => [] as string[]);
      throw new Error(
        `PDF_CONVERSION_OUTPUT_MISSING:${command}:${outputFiles.join("|") || "EMPTY_OUTPUT_DIR"}:${commandMessage(result)}`,
      );
    }
    assertPdfBuffer(pdf);
    return pdf;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function convertDocxToPdfWithMicrosoftWord(
  docx: Uint8Array,
  options: MicrosoftWordPdfConversionOptions = {},
): Promise<Uint8Array> {
  const workDir = await mkdtemp(path.join(tmpdir(), "papot-docx-word-pdf-"));
  const inputPath = path.join(workDir, "quote.docx");
  const outputPath = path.join(workDir, "quote.pdf");
  const scriptPath = path.join(workDir, "convert-word-pdf.ps1");
  const commandRunner = options.commandRunner ?? runPdfCommand;

  try {
    await writeFile(inputPath, docx);
    await writeFile(scriptPath, WORD_PDF_EXPORT_SCRIPT, "utf8");

    const { command, result } = await runFirstAvailable(
      microsoftWordPowerShellCandidates(options.binary),
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        inputPath,
        outputPath,
      ],
      {
        cwd: workDir,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        commandRunner,
      },
    );

    if (result.exitCode !== 0) {
      throw new Error(
        `PDF_WORD_CONVERSION_FAILED:${command}:${result.exitCode}:${commandMessage(result)}`,
      );
    }

    let pdf: Uint8Array;
    try {
      pdf = await readFile(outputPath);
    } catch {
      throw new Error(`PDF_WORD_CONVERSION_OUTPUT_MISSING:${command}:${commandMessage(result)}`);
    }
    assertPdfBuffer(pdf);
    return pdf;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function convertDocxToPdf(
  docx: Uint8Array,
  options: DocxPdfConversionOptions = {},
): Promise<Uint8Array> {
  try {
    return await convertDocxToPdfWithLibreOffice(docx, options);
  } catch (libreOfficeError) {
    const platform = options.platform ?? process.platform;
    if (platform !== "win32" || !isCommandUnavailable(libreOfficeError)) {
      throw libreOfficeError;
    }

    try {
      return await convertDocxToPdfWithMicrosoftWord(docx, {
        binary: options.wordBinary,
        timeoutMs: options.timeoutMs,
        commandRunner: options.wordCommandRunner ?? options.commandRunner,
      });
    } catch (wordError) {
      if (isCommandUnavailable(wordError)) {
        const unavailable = new Error("PDF_CONVERTER_UNAVAILABLE");
        (unavailable as Error & { cause?: unknown }).cause = {
          libreOfficeError,
          wordError,
        };
        throw unavailable;
      }
      const detail = wordError instanceof Error ? wordError.message : "UNKNOWN";
      const failed = new Error(`PDF_WINDOWS_CONVERTER_FAILED:${detail}`);
      (failed as Error & { cause?: unknown }).cause = {
        libreOfficeError,
        wordError,
      };
      throw failed;
    }
  }
}

function pdfRendererCandidates(explicitBinary?: string): string[] {
  if (explicitBinary?.trim()) return [explicitBinary.trim()];
  if (process.env.PAPOT_PDF_RENDERER_BIN?.trim()) {
    return [process.env.PAPOT_PDF_RENDERER_BIN.trim()];
  }
  return ["pdftoppm"];
}

function renderedPageNumber(filename: string): number | null {
  const match = filename.match(/^page-(\d+)\.png$/);
  if (!match) return null;
  return Number(match[1]);
}

export async function renderPdfToPngPages(
  pdf: Uint8Array,
  options: PdfRenderOptions = {},
): Promise<Uint8Array[]> {
  assertPdfBuffer(pdf);
  const workDir = await mkdtemp(path.join(tmpdir(), "papot-pdf-render-"));
  const outputDir = path.join(workDir, "pages");
  const inputPath = path.join(workDir, "input.pdf");
  const outputPrefix = path.join(outputDir, "page");
  const commandRunner = options.commandRunner ?? runPdfCommand;

  try {
    await mkdir(outputDir, { recursive: true });
    await writeFile(inputPath, pdf);
    const { command, result } = await runFirstAvailable(
      pdfRendererCandidates(options.binary),
      ["-png", "-r", String(options.dpi ?? DEFAULT_RENDER_DPI), inputPath, outputPrefix],
      {
        cwd: workDir,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        commandRunner,
      },
    );

    if (result.exitCode !== 0) {
      throw new Error(`PDF_RENDER_FAILED:${command}:${result.exitCode}:${commandMessage(result)}`);
    }

    const files = (await readdir(outputDir))
      .map((filename) => ({ filename, page: renderedPageNumber(filename) }))
      .filter((entry): entry is { filename: string; page: number } => entry.page !== null)
      .sort((left, right) => left.page - right.page);
    if (files.length === 0) throw new Error("PDF_RENDER_NO_PAGES");

    return Promise.all(files.map((entry) => readFile(path.join(outputDir, entry.filename))));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function pageHash(page: Uint8Array): string {
  return createHash("sha256").update(page).digest("hex");
}

export function compareRenderedPdfPages(
  referencePages: Uint8Array[],
  actualPages: Uint8Array[],
): PdfVisualComparison {
  const referencePageHashes = referencePages.map(pageHash);
  const actualPageHashes = actualPages.map(pageHash);
  const maxPages = Math.max(referencePageHashes.length, actualPageHashes.length);
  const changedPages: number[] = [];

  for (let index = 0; index < maxPages; index += 1) {
    if (referencePageHashes[index] !== actualPageHashes[index]) changedPages.push(index + 1);
  }

  return {
    matches: changedPages.length === 0,
    referencePageCount: referencePageHashes.length,
    actualPageCount: actualPageHashes.length,
    changedPages,
    referencePageHashes,
    actualPageHashes,
  };
}

export async function comparePdfVisualRenders(
  referencePdf: Uint8Array,
  actualPdf: Uint8Array,
  options: PdfRenderOptions = {},
): Promise<PdfVisualComparison> {
  const [referencePages, actualPages] = await Promise.all([
    renderPdfToPngPages(referencePdf, options),
    renderPdfToPngPages(actualPdf, options),
  ]);
  return compareRenderedPdfPages(referencePages, actualPages);
}
