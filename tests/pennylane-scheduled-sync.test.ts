import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { authorizedScheduledPennylaneRequest } from "../src/lib/pennylane/scheduled-sync-auth";

describe("synchronisation Pennylane programmée, sécurisée et sans doublon", () => {
  const secret = "a".repeat(64);

  it("accepte seulement le secret indépendant de 256 bits, à temps constant", () => {
    expect(authorizedScheduledPennylaneRequest("Bearer " + secret, secret)).toBe(true);
    expect(authorizedScheduledPennylaneRequest("Bearer " + "b".repeat(64), secret)).toBe(false);
    expect(authorizedScheduledPennylaneRequest("Bearer " + secret, undefined)).toBe(false);
    expect(authorizedScheduledPennylaneRequest(null, secret)).toBe(false);
    expect(authorizedScheduledPennylaneRequest("Bearer 123", secret)).toBe(false);
    expect(authorizedScheduledPennylaneRequest("Bearer " + secret, "weak")).toBe(false);
  });

  it("n'accepte pas un appel public non authentifié", () => {
    const route = readFileSync("src/app/api/internal/pennylane/sync/route.ts", "utf8");
    expect(route).toContain("authorizedScheduledPennylaneRequest");
    expect(route).toContain("SYNC_UNAUTHORIZED");
    expect(route).toContain("PAPOT_PENNYLANE_SYNC_SECRET");
    expect(route).toContain('synchronizePennylane("PAPOT · synchronisation programmée")');
    expect(route).toContain("generalExpensesAssigned");
    expect(route).not.toContain("GET(request");
  });

  it("évite le chevauchement des imports, même avec le bouton manuel", () => {
    const sync = readFileSync("src/lib/pennylane/sync.ts", "utf8");
    expect(sync).toContain("pg_try_advisory_lock");
    expect(sync).toContain('throw new Error("PENNYLANE_SYNC_IN_PROGRESS")');
    expect(sync).toContain("lockClient.release(true)");
  });

  it("prévoit deux passages quotidiens à l'heure Europe/Paris", () => {
    const timer = readFileSync("deploy/agencement-web/systemd/papot-pennylane-sync.timer", "utf8");
    const service = readFileSync(
      "deploy/agencement-web/systemd/papot-pennylane-sync.service",
      "utf8",
    );
    expect(timer).toContain("OnCalendar=*-*-* 06,12:00:00 Europe/Paris");
    expect(timer).toContain("Persistent=true");
    const installer = readFileSync("deploy/agencement-web/install-pennylane-sync.sh", "utf8");
    expect(installer).toContain("http://127.0.0.1:3002/api/internal/pennylane/sync");
    expect(service).toContain("pennylane-sync.curl");
    expect(installer).not.toContain("PENNYLANE_API_TOKEN");
    expect(installer).toContain("systemctl enable papot-pennylane-sync.timer");
    expect(installer).toContain("systemctl start papot-pennylane-sync.timer");
  });
});
