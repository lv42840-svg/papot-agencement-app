import type { OpenSharedResourceResult } from "../sync/resource-edit-coordinator";
import type { SharedResourceLock } from "../sync/resource-lock";
import type { SaveSharedResourceResult } from "../sync/resource-state-store";
import type { LibrarySnapshot } from "./storage";

export interface LibraryRepository {
  load(): Promise<LibrarySnapshot>;
  open(leaseId: string): Promise<OpenSharedResourceResult>;
  save(params: {
    leaseId: string;
    expectedVersion: number;
    payload: unknown;
  }): Promise<SaveSharedResourceResult>;
  renew(leaseId: string): Promise<SharedResourceLock>;
  release(leaseId: string): Promise<boolean>;
}
