import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { LIBRARY_RESOURCE_REF, parseLibraryPayload, SharedResourceLibraryStore } from "./storage";
import type { LibraryRepository } from "./repository";

type Desktop = DesktopRequestContext["desktop"];
type Owner = DesktopRequestContext["owner"];

export function createSharedResourceLibraryRepository(params: {
  desktop: Desktop;
  owner: Owner;
}): LibraryRepository {
  const libraryStore = new SharedResourceLibraryStore(params.desktop.states);

  return {
    load() {
      return libraryStore.get();
    },

    open(leaseId) {
      return params.desktop.coordinator.open({
        resource: LIBRARY_RESOURCE_REF,
        leaseId,
        owner: params.owner,
      });
    },

    async save(input) {
      const payload = parseLibraryPayload(input.payload);
      return params.desktop.coordinator.save({
        resource: LIBRARY_RESOURCE_REF,
        leaseId: input.leaseId,
        owner: params.owner,
        expectedVersion: input.expectedVersion,
        payload,
      });
    },

    renew(leaseId) {
      return params.desktop.locks.renew({
        resource: LIBRARY_RESOURCE_REF,
        leaseId,
        owner: params.owner,
      });
    },

    release(leaseId) {
      return params.desktop.coordinator.release({
        resource: LIBRARY_RESOURCE_REF,
        leaseId,
        owner: params.owner,
      });
    },
  };
}
