import { describe, expect, it } from "vitest";
import { calculateLineProgress } from "../src/lib/billing/progress";
import { buildInvoiceDocumentLines } from "../src/lib/billing/document-lines";
import {
  createBillingDraft, updateBillingDocument,
  type BillingSource, type BillingPayload,
} from "../src/lib/billing/domain";

const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const source: BillingSource = {
  quoteId:"11111111-1111-4111-8111-111111111111",
  commercialCaseId:"22222222-2222-4222-8222-222222222222",
  chantierId:"33333333-3333-4333-8333-333333333333",
  clientId:"44444444-4444-4444-8444-444444444444",
  clientName:"Test", affairName:"Projet", quoteLabel:"D-2026-1000",
  contractHtCents:300_000,
  contractTaxGroups:[{ratePercent:10,baseHtCents:200_000},{ratePercent:20,baseHtCents:100_000}],
  lines:[
    {lineId:a, description:"Fournitures", amountHtCents:200_000,vatRatePercent:10},
    {lineId:b, description:"Pose",amountHtCents:100_000,vatRatePercent:20},
  ],
};
const empty:BillingPayload={schemaVersion:1,drafts:[]};
const amount=(percent:number, payload=empty)=>createBillingDraft(payload,source,{
  requestId:crypto.randomUUID(),type:"PROGRESS", cumulativePercent:percent,
},"Nadia");
describe("correction d'avancement dans l'éditeur de facture",()=>{
  it("enregistre le nouveau pourcentage cumulé avec ses lignes recalculées",()=>{
    const initial=amount(20);
    const rows=[{lineId:a,percent:40},{lineId:b,percent:50}];
    const recomputed=calculateLineProgress(empty,initial,rows);
    const altered={
      ...initial,lineProgress:recomputed.lineProgress,taxGroups:recomputed.tax.groups,
      amountHtCents:recomputed.amountHtCents,vatCents:recomputed.tax.vatCents,
      totalTtcCents:recomputed.tax.ttcCents,
    };
    const lines=buildInvoiceDocumentLines(altered,empty);
    const saved=updateBillingDocument({schemaVersion:1,drafts:[initial]},initial.id,{
      expectedUpdatedAt:initial.updatedAt,label:initial.label,notes:"Avancement corrigé",
      documentLines:lines,linePercentages:rows,
    },"Lucien",new Date("2026-10-17T20:00:00Z"));
    expect(saved.lineProgress?.map(item=>item.percent)).toEqual([40,50]);
    expect(saved.amountHtCents).toBe(130_000);
    expect(saved.taxGroups.map(item=>item.baseHtCents)).toEqual([80_000,50_000]);
    expect(saved.cumulativePercent).toBeNull();
  });

  it("refuse de corriger une ancienne situation quand une suivante existe",()=>{
    const first=amount(20);
    const second=amount(60,{schemaVersion:1,drafts:[first]});
    const rows=[{lineId:a,percent:25},{lineId:b,percent:25}];
    const base=calculateLineProgress(empty,first,rows);
    const document=buildInvoiceDocumentLines({
      ...first,lineProgress:base.lineProgress,taxGroups:base.tax.groups,
      amountHtCents:base.amountHtCents,vatCents:base.tax.vatCents,
      totalTtcCents:base.tax.ttcCents,
    },empty);
    expect(()=>updateBillingDocument({schemaVersion:1,drafts:[first,second]},first.id,{
      expectedUpdatedAt:first.updatedAt,label:first.label,notes:"",
      documentLines:document,linePercentages:rows,
    },"Nadia")).toThrow("BILLING_DRAFT_HAS_DEPENDENTS");
  });
});
