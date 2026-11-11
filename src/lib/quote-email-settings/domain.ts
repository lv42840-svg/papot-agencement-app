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

function validateTemplate(valeur: string, contexte: z.RefinementCtx) {
  for (const correspondance of valeur.matchAll(placeholderPattern)) {
    if (!templateVariableSet.has(correspondance[1])) {
      contexte.addIssue({
        code: z.ZodIssueCode.custom,
        message: `QUOTE_EMAIL_TEMPLATE_UNKNOWN_VARIABLE:${correspondance[1]}`,
      });
    }
  }

  const sansVariables = valeur.replace(placeholderPattern, "");
  if (sansVariables.includes("{{") || sansVariables.includes("}}")) {
    contexte.addIssue({
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
    subjectTemplate: z.string().trim().min(1).max(500).default("Devis {{NUM_DEVIS}} - {{AFFAIRE}}"),
    bodyTemplate: z
      .string()
      .min(1)
      .max(10_000)
      .default(
        "{{BONJOUR}}\n\nVeuillez trouver ci-joint notre devis {{NUM_DEVIS}} concernant {{OBJET_DEVIS}}.\n\nBien cordialement,\nPAPOT AGENCEMENT",
      ),
  })
  .superRefine((parametres, contexte) => {
    validateTemplate(parametres.subjectTemplate, contexte);
    validateTemplate(parametres.bodyTemplate, contexte);
  });

export type QuoteEmailSettings = z.infer<typeof quoteEmailSettingsSchema>;

export function createDefaultQuoteEmailSettings(): QuoteEmailSettings {
  return quoteEmailSettingsSchema.parse({});
}

export function parseQuoteEmailSettings(valeur: unknown): QuoteEmailSettings {
  const analyse = quoteEmailSettingsSchema.safeParse(valeur ?? {});
  if (!analyse.success) {
    throw new Error("QUOTE_EMAIL_SETTINGS_INVALID");
  }
  return analyse.data;
}

export function renderQuoteEmailTemplate(
  modele: string,
  valeurs: Record<(typeof QUOTE_EMAIL_TEMPLATE_VARIABLES)[number], string>,
): string {
  return modele.replace(placeholderPattern, (_correspondance, variable: string) => {
    return valeurs[variable as keyof typeof valeurs] ?? "";
  });
}
