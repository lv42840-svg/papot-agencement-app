import type { QuoteEmailSettings } from "./domain";

export interface QuoteEmailSettingsRepository {
  load(): Promise<QuoteEmailSettings>;
  replace(parametres: QuoteEmailSettings): Promise<QuoteEmailSettings>;
}
