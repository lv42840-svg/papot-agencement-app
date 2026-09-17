import type { ClientContact, ClientRecord } from "../clients/domain";
import { clientDisplayName } from "../clients/domain";
import type { CommercialCase } from "../commercial/domain";
import { calculateQuoteAdjustedPricing, type QuoteOption } from "./adjustments";
import { quoteValidityDate } from "./domain";
import { resolveQuoteLineVatRate } from "./legal-details";
import type {
  QuoteItem,
  QuoteItemPhoto,
  QuoteItemTextStyle,
  QuoteRichText,
} from "./model";
import { buildQuoteItemNumbers } from "./numbering";
import { assertQuotePricingIntegrity } from "./pricing-integrity";
import type { NativeQuoteRecord } from "./store";

export type QuoteDocumentMissingField =
  | "quoteNumber"
  | "workStartDate"
  | "workDuration"
  | "workEndDate"
  | "clientIdentity"
  | "paymentTerms";

export type QuoteDocumentVatLine = {
  ratePercent: number;
  baseHtCents: number;
  vatAmountCents: number;
};

export type QuoteDocumentText = {
  plainText: string;
  textStyle: QuoteItemTextStyle | null;
  richText: QuoteRichText | null;
};

export type QuoteDocumentPhoto = {
  id: string;
  ownerItemId: string;
  fileName: string;
  contentType: QuoteItemPhoto["contentType"];
  sizeBytes: number;
  sha256: string;
  storagePath: string;
};

export type QuoteDocumentSectionRow = {
  kind: "SECTION" | "SUBSECTION";
  sourceItemId: string;
  number: string;
  text: QuoteDocumentText;
  subtotalHtCents: number;
};

export type QuoteDocumentLineRow = {
  kind: "LINE";
  sourceItemId: string;
  number: string;
  text: QuoteDocumentText;
  quantity: number;
  unit: string;
  unitPriceHtCents: number;
  totalHtCents: number;
  vatRatePercent: number;
  vatAmountCents: number;
  totalTtcCents: number;
};

export type QuoteDocumentCommentRow = {
  kind: "COMMENT";
  sourceItemId: string;
  number: string;
  text: QuoteDocumentText;
};

export type QuoteDocumentPhotoRow = {
  kind: "PHOTO";
  sourceItemId: string;
  ownerItemId: string;
  photo: QuoteDocumentPhoto;
};

export type QuoteDocumentBodyRow =
  | QuoteDocumentSectionRow
  | QuoteDocumentLineRow
  | QuoteDocumentCommentRow
  | QuoteDocumentPhotoRow;

export type QuoteDocumentOption = {
  id: string;
  label: string;
  status: "PENDING" | "RETAINED";
  rows: QuoteDocumentBodyRow[];
  totalHtCents: number;
  vatLines: QuoteDocumentVatLine[];
  totalVatCents: number;
  totalTtcCents: number;
};

export type QuoteDocumentViewModel = {
  quote: {
    id: string;
    number: string | null;
    subject: string;
    variantName: string;
    version: number;
    status: NativeQuoteRecord["status"];
    issueDate: string;
    validityDate: string;
    paymentTerms: string;
    workStartDate: string | null;
    workDuration: string;
    workEndDate: string | null;
  };
  client: {
    id: string;
    displayName: string;
    contactName: string | null;
    addressLine1: string;
    addressLine2: string;
    postalCode: string;
    city: string;
    country: null;
    identifierLabel: "SIRET" | null;
    identifier: string | null;
  };
  affair: {
    id: string;
    name: string;
    siteLabel: string | null;
    siteAddressLine1: string;
    siteAddressLine2: string;
    sitePostalCode: string;
    siteCity: string;
  };
  main: {
    rows: QuoteDocumentBodyRow[];
    totalHtCents: number;
    vatLines: QuoteDocumentVatLine[];
    totalVatCents: number;
    totalTtcCents: number;
  };
  options: QuoteDocumentOption[];
  pricingWarnings: string[];
  missingRequiredFields: QuoteDocumentMissingField[];
  readyForPdf: boolean;
};

type BuildQuoteDocumentViewModelInput = {
  quote: NativeQuoteRecord;
  client: ClientRecord;
  commercialCase: CommercialCase;
  quoteNumber?: string | null;
};

type LineFinancial = {
  lineId: string;
  totalHtCents: number;
  vatRatePercent: number;
  vatAmountCents: number;
  totalTtcCents: number;
};

function cloneRichText(richText: QuoteRichText | undefined): QuoteRichText | null {
  if (!richText) return null;
  return {
    runs: richText.runs.map((run) => ({
      text: run.text,
      style: { ...run.style },
    })),
  };
}

function cloneTextStyle(textStyle: QuoteItemTextStyle | undefined): QuoteItemTextStyle | null {
  if (!textStyle) return null;
  return {
    ...textStyle,
    textColorMarks: textStyle.textColorMarks?.map((mark) => ({ ...mark })),
  };
}

function textForItem(item: QuoteItem): QuoteDocumentText {
  const plainText = item.kind === "COMMENT" ? item.text : item.kind === "LINE" ? item.description : item.title;
  return {
    plainText,
    textStyle: cloneTextStyle(item.presentation?.textStyle),
    richText: cloneRichText(item.presentation?.richText),
  };
}

function clientVisiblePhotos(item: QuoteItem): QuoteDocumentPhoto[] {
  return (item.presentation?.photos ?? [])
    .filter((photo) => photo.clientVisible)
    .map((photo) => ({
      id: photo.id,
      ownerItemId: item.id,
      fileName: photo.fileName,
      contentType: photo.contentType,
      sizeBytes: photo.sizeBytes,
      sha256: photo.sha256,
      storagePath: photo.storagePath,
    }));
}

function selectedContact(client: ClientRecord, commercialCase: CommercialCase): ClientContact | null {
  const requested = commercialCase.primaryContactId
    ? client.contacts.find((contact) => contact.id === commercialCase.primaryContactId)
    : undefined;
  return requested ?? client.contacts.find((contact) => contact.isPrimary) ?? null;
}

function contactDisplayName(contact: ClientContact | null): string | null {
  if (!contact) return null;
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null;
}

function optionForItem(
  item: QuoteItem,
  itemById: ReadonlyMap<string, QuoteItem>,
  optionByTarget: ReadonlyMap<string, QuoteOption>,
): QuoteOption | null {
  const direct = optionByTarget.get(item.id);
  if (direct) return direct;
  if (item.kind === "SECTION" || item.parentId === null) return null;

  const parent = itemById.get(item.parentId);
  if (!parent) return null;
  const parentOption = optionByTarget.get(parent.id);
  if (parentOption) return parentOption;

  if (parent.kind === "SUBSECTION") {
    return optionByTarget.get(parent.parentId) ?? null;
  }
  return null;
}

function addMoney(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("QUOTE_DOCUMENT_MONEY_INVALID");
  }
  return total;
}

function buildVatLines(financials: LineFinancial[]): QuoteDocumentVatLine[] {
  const byRate = new Map<number, QuoteDocumentVatLine>();
  for (const financial of financials) {
    const current = byRate.get(financial.vatRatePercent) ?? {
      ratePercent: financial.vatRatePercent,
      baseHtCents: 0,
      vatAmountCents: 0,
    };
    current.baseHtCents = addMoney(current.baseHtCents, financial.totalHtCents);
    current.vatAmountCents = addMoney(current.vatAmountCents, financial.vatAmountCents);
    byRate.set(financial.vatRatePercent, current);
  }
  return [...byRate.values()].sort((left, right) => left.ratePercent - right.ratePercent);
}

function sumFinancials(financials: LineFinancial[]) {
  const totalHtCents = financials.reduce(
    (total, financial) => addMoney(total, financial.totalHtCents),
    0,
  );
  const totalVatCents = financials.reduce(
    (total, financial) => addMoney(total, financial.vatAmountCents),
    0,
  );
  return {
    totalHtCents,
    vatLines: buildVatLines(financials),
    totalVatCents,
    totalTtcCents: addMoney(totalHtCents, totalVatCents),
  };
}

export function buildQuoteDocumentViewModel({
  quote,
  client,
  commercialCase,
  quoteNumber = null,
}: BuildQuoteDocumentViewModelInput): QuoteDocumentViewModel {
  if (quote.model.clientId !== client.id) throw new Error("QUOTE_DOCUMENT_CLIENT_MISMATCH");
  if (quote.commercialCaseId !== commercialCase.id) {
    throw new Error("QUOTE_DOCUMENT_CASE_MISMATCH");
  }
  if (commercialCase.clientId && commercialCase.clientId !== client.id) {
    throw new Error("QUOTE_DOCUMENT_CLIENT_MISMATCH");
  }

  assertQuotePricingIntegrity(quote.model.items, quote.pricingConfig);
  const pricing = calculateQuoteAdjustedPricing(quote.model.items, quote.pricingConfig);
  const adjustedLineById = new Map(pricing.lines.map((line) => [line.lineId, line]));
  const itemById = new Map(quote.model.items.map((item) => [item.id, item]));
  const optionByTarget = new Map(
    quote.pricingConfig.options.map((option) => [option.targetItemId, option]),
  );
  const itemOptionId = new Map(
    quote.model.items.map((item) => [item.id, optionForItem(item, itemById, optionByTarget)?.id ?? null]),
  );
  const numbers = buildQuoteItemNumbers(quote.model.items);
  const headingTotals = new Map<string, number>();
  const lineFinancials = new Map<string, LineFinancial>();

  for (const item of quote.model.items) {
    if (item.kind !== "LINE") continue;
    const adjusted = adjustedLineById.get(item.id);
    if (!adjusted) throw new Error("QUOTE_DOCUMENT_LINE_PRICING_NOT_FOUND");
    const vatRatePercent = resolveQuoteLineVatRate(quote, item.id);
    const vatAmountCents = Math.round((adjusted.saleCents * vatRatePercent) / 100);
    const financial: LineFinancial = {
      lineId: item.id,
      totalHtCents: adjusted.saleCents,
      vatRatePercent,
      vatAmountCents,
      totalTtcCents: addMoney(adjusted.saleCents, vatAmountCents),
    };
    lineFinancials.set(item.id, financial);

    let parentId = item.parentId;
    while (parentId) {
      headingTotals.set(parentId, addMoney(headingTotals.get(parentId) ?? 0, adjusted.saleCents));
      const parent = itemById.get(parentId);
      parentId = parent && parent.kind !== "SECTION" ? parent.parentId : null;
    }
  }

  function rowsForOption(optionId: string | null): QuoteDocumentBodyRow[] {
    const rows: QuoteDocumentBodyRow[] = [];
    for (const item of quote.model.items) {
      if (itemOptionId.get(item.id) !== optionId) continue;
      const number = numbers.get(item.id) ?? "";
      if (item.kind === "SECTION" || item.kind === "SUBSECTION") {
        rows.push({
          kind: item.kind,
          sourceItemId: item.id,
          number,
          text: textForItem(item),
          subtotalHtCents: headingTotals.get(item.id) ?? 0,
        });
      } else if (item.kind === "LINE") {
        const adjusted = adjustedLineById.get(item.id);
        const financial = lineFinancials.get(item.id);
        if (!adjusted || !financial) throw new Error("QUOTE_DOCUMENT_LINE_PRICING_NOT_FOUND");
        rows.push({
          kind: "LINE",
          sourceItemId: item.id,
          number,
          text: textForItem(item),
          quantity: item.quantity,
          unit: item.unit,
          unitPriceHtCents: Math.round(adjusted.saleCents / item.quantity),
          totalHtCents: financial.totalHtCents,
          vatRatePercent: financial.vatRatePercent,
          vatAmountCents: financial.vatAmountCents,
          totalTtcCents: financial.totalTtcCents,
        });
      } else {
        rows.push({
          kind: "COMMENT",
          sourceItemId: item.id,
          number,
          text: textForItem(item),
        });
      }

      for (const photo of clientVisiblePhotos(item)) {
        rows.push({
          kind: "PHOTO",
          sourceItemId: photo.id,
          ownerItemId: item.id,
          photo,
        });
      }
    }
    return rows;
  }

  function financialsForOption(optionId: string | null): LineFinancial[] {
    return quote.model.items
      .filter((item) => item.kind === "LINE" && itemOptionId.get(item.id) === optionId)
      .map((item) => {
        const financial = lineFinancials.get(item.id);
        if (!financial) throw new Error("QUOTE_DOCUMENT_LINE_PRICING_NOT_FOUND");
        return financial;
      });
  }

  const mainFinancial = sumFinancials(financialsForOption(null));
  const options: QuoteDocumentOption[] = quote.pricingConfig.options
    .filter((option): option is QuoteOption & { status: "PENDING" | "RETAINED" } =>
      option.status === "PENDING" || option.status === "RETAINED",
    )
    .map((option) => ({
      id: option.id,
      label: option.label,
      status: option.status,
      rows: rowsForOption(option.id),
      ...sumFinancials(financialsForOption(option.id)),
    }));

  const contact = selectedContact(client, commercialCase);
  const fallbackContactName = commercialCase.contactName?.trim() || null;
  const displayName = clientDisplayName(client).trim();
  const normalizedQuoteNumber = quoteNumber?.trim() || null;
  const missingRequiredFields: QuoteDocumentMissingField[] = [];
  if (!normalizedQuoteNumber) missingRequiredFields.push("quoteNumber");
  if (!quote.workSchedule.startDate) missingRequiredFields.push("workStartDate");
  if (!quote.workSchedule.duration.trim()) missingRequiredFields.push("workDuration");
  if (!quote.workSchedule.endDate) missingRequiredFields.push("workEndDate");
  if (!displayName) missingRequiredFields.push("clientIdentity");
  if (!quote.model.paymentTerms.trim()) missingRequiredFields.push("paymentTerms");

  return {
    quote: {
      id: quote.id,
      number: normalizedQuoteNumber,
      subject: quote.model.subject,
      variantName: quote.variantName,
      version: quote.version,
      status: quote.status,
      issueDate: quote.model.issueDate,
      validityDate: quoteValidityDate(quote.model.issueDate, quote.model.validityDays),
      paymentTerms: quote.model.paymentTerms,
      workStartDate: quote.workSchedule.startDate,
      workDuration: quote.workSchedule.duration,
      workEndDate: quote.workSchedule.endDate,
    },
    client: {
      id: client.id,
      displayName,
      contactName: contactDisplayName(contact) ?? fallbackContactName,
      addressLine1: client.addressLine1,
      addressLine2: client.addressLine2,
      postalCode: client.postalCode,
      city: client.city,
      country: null,
      identifierLabel: client.siret ? "SIRET" : null,
      identifier: client.siret || null,
    },
    affair: {
      id: commercialCase.id,
      name: commercialCase.name,
      siteLabel: commercialCase.siteLabel,
      siteAddressLine1: commercialCase.siteAddressOverride?.addressLine1 ?? "",
      siteAddressLine2: commercialCase.siteAddressOverride?.addressLine2 ?? "",
      sitePostalCode: commercialCase.siteAddressOverride?.postalCode ?? "",
      siteCity: commercialCase.siteAddressOverride?.city ?? "",
    },
    main: {
      rows: rowsForOption(null),
      ...mainFinancial,
    },
    options,
    pricingWarnings: [...pricing.warnings],
    missingRequiredFields,
    readyForPdf: missingRequiredFields.length === 0 && pricing.warnings.length === 0,
  };
}
