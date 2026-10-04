import type { QuoteEmailSettings } from "./domain";

export interface QuoteEmailSettingsRepository {
  load(): Promise<QuoteEmailSettings>;
  replace(settings: QuoteEmailSettings): Promise<QuoteEmailSettings>;
}
