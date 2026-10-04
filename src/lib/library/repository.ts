import type { LibraryEditLock, OpenLibraryResult, SaveLibraryEditResult } from "./edit-lock";
import type { LibrarySnapshot } from "./storage";

export interface LibraryRepository {
  load(): Promise<LibrarySnapshot>;
  open(leaseId: string): Promise<OpenLibraryResult>;
  save(params: {
    leaseId: string;
    expectedVersion: number;
    payload: unknown;
  }): Promise<SaveLibraryEditResult>;
  renew(leaseId: string): Promise<LibraryEditLock>;
  release(leaseId: string): Promise<boolean>;
}
