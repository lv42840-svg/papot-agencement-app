import { describe, expect, it } from "vitest";
import { createSerializedReentrantWriteExecutor } from "../src/lib/local-db/write-executor";

type FakeDatabase = {
  events: string[];
  state: string[];
  transactionStart: string[];
};

function createFakeDatabaseExecutor() {
  const database: FakeDatabase = {
    events: [],
    state: [],
    transactionStart: [],
  };

  const executeWrite = createSerializedReentrantWriteExecutor<FakeDatabase>({
    getTarget: () => database,
    begin: (target) => {
      target.events.push("BEGIN");
      target.transactionStart = [...target.state];
    },
    commit: (target) => {
      target.events.push("COMMIT");
      target.transactionStart = [];
    },
    rollback: (target) => {
      target.events.push("ROLLBACK");
      target.state = [...target.transactionStart];
      target.transactionStart = [];
    },
  });

  return { database, executeWrite };
}

describe("local database nested writes", () => {
  it("reuses the active transaction for a nested client write during affair creation", async () => {
    const { database, executeWrite } = createFakeDatabaseExecutor();

    await executeWrite(async (target) => {
      target.events.push("AFFAIR_START");
      target.state.push("Nouvelle affaire");

      await executeWrite((nestedTarget) => {
        nestedTarget.events.push("CLIENT_WRITE");
        nestedTarget.state.push("Nouveau client");
      });

      target.events.push("AFFAIR_END");
    });

    expect(database.events).toEqual([
      "BEGIN",
      "AFFAIR_START",
      "CLIENT_WRITE",
      "AFFAIR_END",
      "COMMIT",
    ]);
    expect(database.events.filter((event) => event === "BEGIN")).toHaveLength(1);
    expect(database.state).toEqual(["Nouvelle affaire", "Nouveau client"]);
  });

  it("rolls back the nested client write when the outer affair write fails", async () => {
    const { database, executeWrite } = createFakeDatabaseExecutor();
    database.state.push("État initial");

    await expect(
      executeWrite(async (target) => {
        target.events.push("AFFAIR_START");
        target.state.push("Nouvelle affaire");

        await executeWrite((nestedTarget) => {
          nestedTarget.events.push("CLIENT_WRITE");
          nestedTarget.state.push("Client à annuler");
        });

        throw new Error("AFFAIR_CREATION_FAILED");
      }),
    ).rejects.toThrow("AFFAIR_CREATION_FAILED");

    expect(database.events).toEqual(["BEGIN", "AFFAIR_START", "CLIENT_WRITE", "ROLLBACK"]);
    expect(database.state).toEqual(["État initial"]);
  });
});
