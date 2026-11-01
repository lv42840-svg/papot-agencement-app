import { test, expect } from "@playwright/test";

test("connexion, modules métier, capture sans doublon et déconnexion", async ({
  page,
  request,
}) => {
  const bootstrap = await request.post("/api/auth/bootstrap-admin", {
    data: {
      bootstrapToken: "isolated-e2e-bootstrap-token-only",
      username: "audit-admin",
      displayName: "Audit Admin",
      email: "audit@example.test",
      password: "Isolated-test-password-2026",
    },
  });
  expect([200, 409]).toContain(bootstrap.status());
  await page.goto("/login");
  await page.getByLabel("Identifiant").fill("audit-admin");
  await page.getByLabel("Mot de passe", { exact: true }).fill("Isolated-test-password-2026");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  for (const path of ["/devis", "/chantiers", "/heures", "/facturation"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.locator("body")).not.toContainText("Une erreur est survenue");
  }
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { data });
    const body = await response.json();
    expect(response.ok(), JSON.stringify(body)).toBeTruthy();
    return body;
  };
  const client = await post("/api/desktop/clients", {
    action: "create",
    type: "ENTREPRISE",
    companyName: "Client audit",
    addressLine1: "1 rue du Test",
    postalCode: "69000",
    city: "Lyon",
    siret: "12345678901234",
    paymentTerms: "30 jours",
  });
  const affair = await post("/api/desktop/commercial", {
    action: "create",
    name: "Affaire audit",
    existingClientId: client.focusClientId,
    reviewDate: "2026-01-01",
  });
  await page.goto(`/devis/nouveau?affaire=${affair.focusCaseId}`);
  await page.getByLabel("Objet", { exact: true }).fill("Devis navigateur audit");
  await page.getByLabel("Date prévue d’envoi", { exact: true }).fill("2026-12-01");
  await page.getByRole("button", { name: "Créer et ouvrir Base V1" }).click();
  await expect(page).toHaveURL(/\/devis\/[0-9a-f-]{36}$/);
  const commercial = await (await page.request.get("/api/desktop/commercial")).json();
  const current = commercial.payload.cases.find(
    (item: { id: string }) => item.id === affair.focusCaseId,
  );
  await post("/api/desktop/commercial", {
    action: "setStatus",
    caseId: current.id,
    status: "CONFIRMED",
    plannedInstallDate: "2026-12-01",
    confirmWithoutQuote: true,
    expectedUpdatedAt: current.updatedAt,
  });
  const launch = { commercialCaseId: current.id, be: 0, workshop: 0, install: 0 };
  const first = await post("/api/desktop/chantiers/launch", launch);
  const repeated = await post("/api/desktop/chantiers/launch", launch);
  expect(repeated.focusChantierId).toBe(first.focusChantierId);
  await page.goto(`/chantiers/${first.focusChantierId}`);
  await expect(page.locator("body")).toContainText("Affaire audit");
  const users = await (await page.request.get("/api/admin/users")).json();
  const userId = users.users.find(
    (user: { username: string }) => user.username === "audit-admin",
  ).id;
  const hours = {
    action: "saveActualHoursRow",
    chantierId: first.focusChantierId,
    userId,
    week: "2025-W01",
    be: 2,
    workshop: 3,
    install: 4,
    expectedRevision: 0,
  };
  const saved = await post("/api/desktop/planning/actual-hours", hours);
  expect(saved.editHistory.at(-1).after.be).toBe(2);
  const stale = await page.request.post("/api/desktop/planning/actual-hours", {
    data: { ...hours, be: 99 },
  });
  expect(stale.status()).toBe(409);
  const payroll = {
    action: "saveMonthlyLaborCost",
    month: "2025-01",
    personId: userId,
    employerCostCents: 300000,
    workedHours: 150,
    expectedRevision: 0,
  };
  await post("/api/desktop/payroll/monthly-labor-costs", payroll);
  expect(
    (
      await page.request.post("/api/desktop/payroll/monthly-labor-costs", { data: payroll })
    ).status(),
  ).toBe(409);
  await page.goto("/capture");
  await page.getByPlaceholder(/Ex\. chantier/).fill("Capture audit navigateur");
  const outgoing = page.waitForRequest(
    (req) => req.url().endsWith("/api/mobile/entries/capture") && req.method() === "POST",
  );
  await page.getByRole("button", { name: "Envoyer l’entrée" }).click();
  const sent = await outgoing;
  await expect(page.getByText("Entrée envoyée.", { exact: true })).toBeVisible();
  const retry = await page.request.post("/api/mobile/entries/capture", {
    data: sent.postDataJSON(),
  });
  expect(retry.ok()).toBeTruthy();
  const result = await retry.json();
  expect(
    result.payload.entries.filter(
      (entry: { rawText: string }) => entry.rawText === "Capture audit navigateur",
    ),
  ).toHaveLength(1);
  const wrongOwner = await page.request.post("/api/mobile/entries/capture", {
    data: { ...sent.postDataJSON(), ownerUserId: "11111111-1111-4111-8111-111111111111" },
  });
  expect(wrongOwner.status()).toBe(403);
  await page.request.post("/api/auth/logout");
  await page.goto("/heures");
  await expect(page).toHaveURL(/login/);
});
