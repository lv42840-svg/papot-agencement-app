import { clientDisplayName, type ClientRecord } from "../clients/domain";
import type { CommercialCase } from "../commercial/domain";
import { calculateQuoteAdjustedPricing, type QuoteOptionStatus } from "./adjustments";
import type { QuoteItemPhoto, QuoteRichText } from "./model";
import { buildQuoteItemNumbers } from "./numbering";
import type { NativeQuoteRecord } from "./store";

export type QuoteDocumentCompanyProfile = {
  name: string;
  addressLine1: string;
  postalCode: string;
  city: string;
  legalForm: string;
  capital: string;
  siret: string;
  rcs: string;
  ape: string;
  vatNumber: string;
  phone: string;
  email: string;
  insurerName: string;
  insurerAddress: string;
  insuranceCoverage: string;
  bankName: string;
  bankAccountHolder: string;
  iban: string;
  bic: string;
  paymentMethods: string;
  chequePayee: string;
};

export type QuoteDocumentItemKind = "SECTION" | "SUBSECTION" | "LINE" | "COMMENT";
export type QuoteDocumentItemScope =
  | "MAIN"
  | "PENDING_OPTION"
  | "RETAINED_OPTION"
  | "REJECTED_OPTION";

export type QuoteDocumentTaxLine = {
  ratePercent: number;
  baseHtCents: number;
  vatCents: number;
};

export type QuoteDocumentItem = {
  id: string;
  kind: QuoteDocumentItemKind;
  number: string;
  parentId: string | null;
  text: string;
  richText: QuoteRichText | null;
  clientPhotos: QuoteItemPhoto[];
  scope: QuoteDocumentItemScope;
  optionId: string | null;
  optionLabel: string | null;
  optionStatus: QuoteOptionStatus | null;
  quantity: number | null;
  unit: string | null;
  unitPriceHt: number | null;
  totalHtCents: number | null;
  vatRatePercent: number | null;
  vatCents: number | null;
};

export type QuoteDocumentPendingOption = {
  id: string;
  label: string;
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
};

export type QuoteDocumentData = {
  quote: {
    id: string;
    number: string;
    variantName: string;
    version: number;
    versionLabel: string;
    issueDate: string;
    validityDate: string;
    subject: string;
    paymentTerms: string;
    workStartDate: string;
    workDuration: string;
    workEndDate: string;
  };
  company: QuoteDocumentCompanyProfile;
  client: {
    id: string;
    displayName: string;
    contactName: string;
    addressLine1: string;
    addressLine2: string;
    postalCode: string;
    city: string;
    country: string;
    identifierLabel: string | null;
    identifier: string | null;
  };
  affair: {
    id: string;
    name: string;
    siteLabel: string;
    siteAddressLine1: string;
    siteAddressLine2: string;
    sitePostalCode: string;
    siteCity: string;
  };
  items: QuoteDocumentItem[];
  totals: {
    grossTotalHtCents: number;
    customerDiscountCents: number;
    customerDiscountLabel: string | null;
    totalHtCents: number;
    totalVatCents: number;
    totalTtcCents: number;
    taxLines: QuoteDocumentTaxLine[];
  };
  pendingOptions: QuoteDocumentPendingOption[];
};

export type QuoteWordV2ScalarData = {
  societe_nom: string;
  societe_adresse: string;
  societe_adresse_ligne1: string;
  societe_cp: string;
  societe_ville: string;
  societe_forme: string;
  societe_capital: string;
  societe_siret: string;
  societe_rcs: string;
  societe_ape: string;
  societe_tva: string;
  societe_tel: string;
  societe_email: string;
  assureur_nom: string;
  assureur_adresse: string;
  assurance_couverture: string;
  devis_numero: string;
  devis_date: string;
  devis_validite: string;
  travaux_debut: string;
  travaux_duree: string;
  travaux_fin_limite: string;
  client_raison_sociale: string;
  client_contact_nom: string;
  client_adresse_ligne1: string;
  client_cp: string;
  client_ville: string;
  client_pays: string;
  client_identifiant_label: string;
  client_identifiant: string;
  affaire_nom: string;
  chantier_ville: string;
  conditions_paiement: string;
  methodes_paiement: string;
  libelle_cheques: string;
  banque_nom: string;
  banque_titulaire: string;
  banque_iban: string;
  banque_bic: string;
  total_ht: string;
  total_ttc: string;
  net_a_payer: string;
};

export type BuildQuoteDocumentDataInput = {
  quote: NativeQuoteRecord;
  client: ClientRecord;
  commercialCase: CommercialCase;
  company: QuoteDocumentCompanyProfile;
  quoteNumber: string;
  clientCountry?: string;
};

const moneyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

function formatDateFr(dateKey: string): string {
  const [year, month, day] = dateKey.split("-");
  if (!year || !month || !day) throw new Error("QUOTE_DOCUMENT_DATE_INVALID");
  return `${day}/${month}/${year}`;
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("QUOTE_DOCUMENT_DATE_INVALID");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function resolvePrimaryContactName(client: ClientRecord, commercialCase: CommercialCase): string {
  const selected = commercialCase.primaryContactId
    ? client.contacts.find((contact) => contact.id === commercialCase.primaryContactId)
    : undefined;
  const primary = selected ?? client.contacts.find((contact) => contact.isPrimary);
  if (primary) {
    return [primary.firstName, primary.lastName].filter(Boolean).join(" ").trim();
  }
  if (commercialCase.contactName?.trim()) return commercialCase.contactName.trim();
  if (client.type === "PARTICULIER") {
    return [client.firstName, client.lastName].filter(Boolean).join(" ").trim();
  }
  return "";
}

function itemText(item: NativeQuoteRecord["model"]["items"][number]): string {
  if (item.kind === "SECTION" || item.kind === "SUBSECTION") return item.title;
  if (item.kind === "COMMENT") return item.text;
  return item.description;
}

function itemRichText(item: NativeQuoteRecord["model"]["items"][number]): QuoteRichText | null {
  return item.presentation?.richText ?? null;
}

function itemClientPhotos(item: NativeQuoteRecord["model"]["items"][number]): QuoteItemPhoto[] {
  return (item.presentation?.photos ?? []).filter((photo) => photo.clientVisible);
}

function scopeFromOptionStatus(status: QuoteOptionStatus | null): QuoteDocumentItemScope {
  if (status === "PENDING") return "PENDING_OPTION";
  if (status === "RETAINED") return "RETAINED_OPTION";
  if (status === "REJECTED") return "REJECTED_OPTION";
  return "MAIN";
}

function resolveHeadingOption(
  itemId: string,
  parentId: string | null,
  optionByTarget: ReadonlyMap<string, NativeQuoteRecord["pricingConfig"]["options"][number]>,
  itemById: ReadonlyMap<string, NativeQuoteRecord["model"]["items"][number]>,
) {
  const direct = optionByTarget.get(itemId);
  if (direct) return direct;
  if (!parentId) return null;
  const parentOption = optionByTarget.get(parentId);
  if (parentOption) return parentOption;
  const parent = itemById.get(parentId);
  if (parent?.kind === "SUBSECTION") return optionByTarget.get(parent.parentId) ?? null;
  return null;
}

function resolveVatRate(quote: NativeQuoteRecord, lineId: string): number {
  return (
    quote.taxConfig.lineOverrides.find((override) => override.lineId === lineId)?.ratePercent ??
    quote.taxConfig.defaultRatePercent
  );
}

function vatAmount(baseHtCents: number, ratePercent: number): number {
  return Math.round((baseHtCents * ratePercent) / 100);
}

function buildTaxLines(lines: QuoteDocumentItem[]): QuoteDocumentTaxLine[] {
  const grouped = new Map<number, { baseHtCents: number; vatCents: number }>();
  for (const line of lines) {
    if (line.kind !== "LINE" || line.totalHtCents === null || line.vatRatePercent === null)
      continue;
    const current = grouped.get(line.vatRatePercent) ?? { baseHtCents: 0, vatCents: 0 };
    current.baseHtCents += line.totalHtCents;
    current.vatCents += line.vatCents ?? 0;
    grouped.set(line.vatRatePercent, current);
  }
  return Array.from(grouped, ([ratePercent, totals]) => ({ ratePercent, ...totals })).sort(
    (left, right) => left.ratePercent - right.ratePercent,
  );
}

function assertDocumentReady(input: BuildQuoteDocumentDataInput): void {
  if (input.quote.model.clientId !== input.client.id) {
    throw new Error("QUOTE_DOCUMENT_CLIENT_MISMATCH");
  }
  if (input.quote.commercialCaseId !== input.commercialCase.id) {
    throw new Error("QUOTE_DOCUMENT_AFFAIR_MISMATCH");
  }
  if (!input.quoteNumber.trim()) throw new Error("QUOTE_DOCUMENT_NUMBER_REQUIRED");
  if (!input.company.name.trim()) throw new Error("QUOTE_DOCUMENT_COMPANY_REQUIRED");
  if (!input.quote.workSchedule.startDate) throw new Error("QUOTE_DOCUMENT_WORK_START_REQUIRED");
  if (!input.quote.workSchedule.duration.trim()) {
    throw new Error("QUOTE_DOCUMENT_WORK_DURATION_REQUIRED");
  }
  if (!input.quote.workSchedule.endDate) throw new Error("QUOTE_DOCUMENT_WORK_END_REQUIRED");
}

export function buildQuoteDocumentData(input: BuildQuoteDocumentDataInput): QuoteDocumentData {
  assertDocumentReady(input);

  const { quote, client, commercialCase } = input;
  const adjusted = calculateQuoteAdjustedPricing(quote.model.items, quote.pricingConfig);
  if (adjusted.warnings.length > 0) throw new Error("QUOTE_DOCUMENT_PRICING_WARNING");

  const numbers = buildQuoteItemNumbers(quote.model.items);
  const adjustedLineById = new Map(adjusted.lines.map((line) => [line.lineId, line]));
  const optionByTarget = new Map(
    quote.pricingConfig.options.map((option) => [option.targetItemId, option]),
  );
  const optionById = new Map(quote.pricingConfig.options.map((option) => [option.id, option]));
  const itemById = new Map(quote.model.items.map((item) => [item.id, item]));

  let items: QuoteDocumentItem[] = quote.model.items.map((item) => {
    const adjustedLine = item.kind === "LINE" ? (adjustedLineById.get(item.id) ?? null) : null;
    const option = adjustedLine
      ? adjustedLine.optionId
        ? (optionById.get(adjustedLine.optionId) ?? null)
        : null
      : resolveHeadingOption(item.id, item.parentId, optionByTarget, itemById);
    const optionStatus = adjustedLine?.optionStatus ?? option?.status ?? null;
    const totalHtCents = adjustedLine?.saleCents ?? null;
    const ratePercent = item.kind === "LINE" ? resolveVatRate(quote, item.id) : null;

    return {
      id: item.id,
      kind: item.kind,
      number: numbers.get(item.id) ?? "",
      parentId: item.parentId,
      text: itemText(item),
      richText: itemRichText(item),
      clientPhotos: itemClientPhotos(item),
      scope: scopeFromOptionStatus(optionStatus),
      optionId: option?.id ?? adjustedLine?.optionId ?? null,
      optionLabel: option?.label ?? null,
      optionStatus,
      quantity: item.kind === "LINE" ? item.quantity : null,
      unit: item.kind === "LINE" ? item.unit : null,
      unitPriceHt:
        item.kind === "LINE" && totalHtCents !== null ? totalHtCents / 100 / item.quantity : null,
      totalHtCents,
      vatRatePercent: ratePercent,
      vatCents:
        totalHtCents !== null && ratePercent !== null ? vatAmount(totalHtCents, ratePercent) : null,
    };
  });

  const documentItemById = new Map(items.map((item) => [item.id, item]));
  const headingTotals = new Map<string, number>();

  const addHeadingTotal = (headingId: string, line: QuoteDocumentItem) => {
    const heading = documentItemById.get(headingId);
    if (!heading || (heading.kind !== "SECTION" && heading.kind !== "SUBSECTION")) return;

    const sameScope =
      heading.scope === "PENDING_OPTION"
        ? line.scope === "PENDING_OPTION" && line.optionId === heading.optionId
        : heading.scope === "REJECTED_OPTION"
          ? false
          : heading.scope === "RETAINED_OPTION"
            ? line.scope === "RETAINED_OPTION" && line.optionId === heading.optionId
            : line.scope === "MAIN" || line.scope === "RETAINED_OPTION";

    if (!sameScope || line.totalHtCents === null) return;
    headingTotals.set(headingId, (headingTotals.get(headingId) ?? 0) + line.totalHtCents);
  };

  for (const line of items) {
    if (line.kind !== "LINE" || !line.parentId) continue;
    addHeadingTotal(line.parentId, line);
    const parent = documentItemById.get(line.parentId);
    if (parent?.kind === "SUBSECTION") addHeadingTotal(parent.parentId, line);
  }

  items = items.map((item) =>
    item.kind === "SECTION" || item.kind === "SUBSECTION"
      ? { ...item, totalHtCents: headingTotals.get(item.id) ?? null }
      : item,
  );

  const mainLines = items.filter(
    (item) => item.kind === "LINE" && (item.scope === "MAIN" || item.scope === "RETAINED_OPTION"),
  );
  const taxLines = buildTaxLines(mainLines);
  const totalVatCents = taxLines.reduce((sum, line) => sum + line.vatCents, 0);

  const pendingOptions = quote.pricingConfig.options
    .filter((option) => option.status === "PENDING")
    .map((option) => {
      const optionLines = items.filter(
        (item) =>
          item.kind === "LINE" && item.optionId === option.id && item.scope === "PENDING_OPTION",
      );
      const totalHtCents = optionLines.reduce((sum, item) => sum + (item.totalHtCents ?? 0), 0);
      const totalVatCentsForOption = optionLines.reduce(
        (sum, item) => sum + (item.vatCents ?? 0),
        0,
      );
      return {
        id: option.id,
        label: option.label,
        totalHtCents,
        totalVatCents: totalVatCentsForOption,
        totalTtcCents: totalHtCents + totalVatCentsForOption,
      };
    });

  const siteAddress = commercialCase.siteAddressOverride;
  const identifier = client.type === "PARTICULIER" || !client.siret ? null : client.siret;

  return {
    quote: {
      id: quote.id,
      number: input.quoteNumber.trim(),
      variantName: quote.variantName,
      version: quote.version,
      versionLabel: `${quote.variantName} V${quote.version}`,
      issueDate: quote.model.issueDate,
      validityDate: addDays(quote.model.issueDate, quote.model.validityDays),
      subject: quote.model.subject,
      paymentTerms: quote.model.paymentTerms,
      workStartDate: quote.workSchedule.startDate ?? "",
      workDuration: quote.workSchedule.duration,
      workEndDate: quote.workSchedule.endDate ?? "",
    },
    company: input.company,
    client: {
      id: client.id,
      displayName: clientDisplayName(client),
      contactName: resolvePrimaryContactName(client, commercialCase),
      addressLine1: client.addressLine1,
      addressLine2: client.addressLine2,
      postalCode: client.postalCode,
      city: client.city,
      country: input.clientCountry?.trim() ?? "",
      identifierLabel: identifier ? "SIRET" : null,
      identifier,
    },
    affair: {
      id: commercialCase.id,
      name: commercialCase.name,
      siteLabel: commercialCase.siteLabel ?? "",
      siteAddressLine1: siteAddress?.addressLine1 || client.addressLine1,
      siteAddressLine2: siteAddress?.addressLine2 || client.addressLine2,
      sitePostalCode: siteAddress?.postalCode || client.postalCode,
      siteCity: siteAddress?.city || client.city,
    },
    items,
    totals: {
      grossTotalHtCents: adjusted.grossSaleCents,
      customerDiscountCents: adjusted.customerDiscountCents,
      customerDiscountLabel: quote.pricingConfig.customerDiscount
        ? quote.pricingConfig.customerDiscount.kind === "PERCENTAGE"
          ? `Remise client ${quote.pricingConfig.customerDiscount.percent.toLocaleString("fr-FR")} %`
          : "Remise client"
        : null,
      totalHtCents: adjusted.totalSaleCents,
      totalVatCents,
      totalTtcCents: adjusted.totalSaleCents + totalVatCents,
      taxLines,
    },
    pendingOptions,
  };
}

export function buildQuoteWordV2ScalarData(document: QuoteDocumentData): QuoteWordV2ScalarData {
  const companyAddress = [
    document.company.addressLine1,
    [document.company.postalCode, document.company.city].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  return {
    societe_nom: document.company.name,
    societe_adresse: companyAddress,
    societe_adresse_ligne1: document.company.addressLine1,
    societe_cp: document.company.postalCode,
    societe_ville: document.company.city,
    societe_forme: document.company.legalForm,
    societe_capital: document.company.capital,
    societe_siret: document.company.siret,
    societe_rcs: document.company.rcs,
    societe_ape: document.company.ape,
    societe_tva: document.company.vatNumber,
    societe_tel: document.company.phone,
    societe_email: document.company.email,
    assureur_nom: document.company.insurerName,
    assureur_adresse: document.company.insurerAddress,
    assurance_couverture: document.company.insuranceCoverage,
    devis_numero: document.quote.number,
    devis_date: formatDateFr(document.quote.issueDate),
    devis_validite: formatDateFr(document.quote.validityDate),
    travaux_debut: formatDateFr(document.quote.workStartDate),
    travaux_duree: document.quote.workDuration,
    travaux_fin_limite: formatDateFr(document.quote.workEndDate),
    client_raison_sociale: document.client.displayName,
    client_contact_nom: document.client.contactName,
    client_adresse_ligne1: document.client.addressLine1,
    client_cp: document.client.postalCode,
    client_ville: document.client.city,
    client_pays: document.client.country,
    client_identifiant_label: document.client.identifierLabel ?? "",
    client_identifiant: document.client.identifier ?? "",
    affaire_nom: document.affair.name,
    chantier_ville: document.affair.siteCity,
    conditions_paiement: document.quote.paymentTerms,
    methodes_paiement: document.company.paymentMethods,
    libelle_cheques: document.company.chequePayee,
    banque_nom: document.company.bankName,
    banque_titulaire: document.company.bankAccountHolder,
    banque_iban: document.company.iban,
    banque_bic: document.company.bic,
    total_ht: formatMoney(document.totals.totalHtCents),
    total_ttc: formatMoney(document.totals.totalTtcCents),
    net_a_payer: formatMoney(document.totals.totalTtcCents),
  };
}
