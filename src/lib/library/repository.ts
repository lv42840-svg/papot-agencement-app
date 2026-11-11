import type {
  LibraryEditLock,
  OpenLibraryResult,
  SaveLibraryEditResult,
} from "./edit-lock";
import type { LibrarySnapshot } from "./storage";

export interface LibraryRepository {
  load(): Promise<LibrarySnapshot>;
  open(idBail: string): Promise<OpenLibraryResult>;
  save(parametres: {
    leaseId: string;
    expectedVersion: number;
    payload: unknown;
  }): Promise<SaveLibraryEditResult>;
  renew(idBail: string): Promise<LibraryEditLock>;
  release(idBail: string): Promise<boolean>;
}
