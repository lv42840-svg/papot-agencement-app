import { z } from "zod";

export const QUOTE_EMAIL_TEMPLATE_VARIABLES = [
  "AFFAIRE",
  "BONJOUR",
  "CLIENT",
  "CONTACT",
  "NUM_DEVIS",
  "OBJET_DEVIS",
] as const;

const templateVariableSet = new Set<string>(QUOTE_EMAIL_TEMPLATE_VARIABLES);
const placeholderPattern = /\{\{([A-Z0-9_]+)\}\}/g;

function validateTemplate(value: string, context: z.RefinementCtx) {
  for (const match of value.matchAll(placeholderPattern)) {
    if (!templateVariableSet.has(match[1])) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `QUOTE_EMAIL_TEMPLATE_UNKNOWN_VARIABLE:${match[1]}`,
      });
    }
  }

  const withoutVariables = value.replace(placeholderPattern, "");
  if (withoutVariables.includes("{{") || withoutVariables.includes("}}")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "QUOTE_EMAIL_TEMPLATE_INVALID_PLACEHOLDER",
    });
  }
}

export const quoteEmailSettingsSchema = z
  .object({
    fromEmail: z.string().trim().email().max(240).default("noreply@papot.app"),
    ccEmail: z.string().trim().email().max(240).default("contact@papot.eu"),
    replyToEmail: z.string().trim().email().max(240).default("contact@papot.eu"),
    subjectTemplate: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .default("Devis {{NUM_DEVIS}} - {{AFFAIRE}}"),
    bodyTemplate: z
      .string()
      .min(1)
      .max(10_000)
      .default(
        "{{BONJOUR}}\n\nVeuillez trouver ci-joint notre devis {{NUM_DEVIS}} concernant {{OBJET_DEVIS}}.\n\nBien cordialement,\nPAPOT AGENCEMENT",
      ),
  })
  .superRefine((settings, context) => {
    validateTemplate(settings.subjectTemplate, context);
    validateTemplate(settings.bodyTemplate, context);
  });

export type QuoteEmailSettings = z.infer<typeof quoteEmailSettingsSchema>;

export function createDefaultQuoteEmailSettings(): QuoteEmailSettings {
  return quoteEmailSettingsSchema.parse({});
}

export function parseQuoteEmailSettings(value: unknown): QuoteEmailSettings {
  const parsed = quoteEmailSettingsSchema.safeParse(value ?? {});
  if (!parsed.success) throw new Error("QUOTE_EMAIL_SETTINGS_INVALID");
  return parsed.data;
}

export function renderQuoteEmailTemplate(
  template: string,
  values: Record<(typeof QUOTE_EMAIL_TEMPLATE_VARIABLES)[number], string>,
): string {
  return template.replace(placeholderPattern, (_match, variable: string) => {
    return values[variable as keyof typeof values] ?? "";
  });
}
