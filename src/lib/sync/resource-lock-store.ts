import { NextcloudDavClient, type TextWithEtag } from "./nextcloud-dav";
import {
  createResourceLock,
  isResourceLockExpired,
  isResourceLockOwnedBy,
  renewResourceLock,
  resourceLockPathSegments,
  sharedResourceLockSchema,
  type ResourceLockOwner,
  type SharedResourceLock,
  type SharedResourceRef,
} from "./resource-lock";

type LockDavClient = Pick<
  NextcloudDavClient,
  | "filesRoot"
  | "childUrl"
  | "ensurePath"
  | "getTextWithEtag"
  | "putTextIfAbsent"
  | "putTextIfMatch"
  | "deleteIfMatch"
>;

type LockRecord = {
  lock: SharedResourceLock;
  etag: string;
};

export type AcquireResourceLockResult =
  | { status: "acquired"; lock: SharedResourceLock }
  | { status: "locked"; lock: SharedResourceLock };

function encodeLock(lock: SharedResourceLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

function parseLock(record: TextWithEtag): LockRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(record.text);
  } catch {
    throw new Error("LOCK_FILE_INVALID_JSON");
  }

  const parsed = sharedResourceLockSchema.safeParse(raw);
  if (!parsed.success) throw new Error("LOCK_FILE_INVALID");

  return {
    lock: parsed.data,
    etag: record.etag,
  };
}

export class NextcloudResourceLockStore {
  constructor(
    private readonly dav: LockDavClient,
    private readonly nextcloudUserId: string,
    private readonly syncRoot = "PAPOT_SYNC",
  ) {}

  private async lockUrl(resource: SharedResourceRef): Promise<string> {
    const filesRoot = this.dav.filesRoot(this.nextcloudUserId);
    const [locksSegment, typeSegment, fileName] = resourceLockPathSegments(resource);
    const collection = await this.dav.ensurePath(filesRoot, [
      this.syncRoot,
      locksSegment,
      typeSegment,
    ]);
    return this.dav.childUrl(collection, fileName);
  }

  private async readRecordAt(url: string): Promise<LockRecord | null> {
    const record = await this.dav.getTextWithEtag(url);
    return record ? parseLock(record) : null;
  }

  async getActiveLock(
    resource: SharedResourceRef,
    now: Date = new Date(),
  ): Promise<SharedResourceLock | null> {
    const url = await this.lockUrl(resource);
    const record = await this.readRecordAt(url);
    if (!record || isResourceLockExpired(record.lock, now)) return null;
    return record.lock;
  }

  async acquire(params: {
    resource: SharedResourceRef;
    leaseId: string;
    owner: ResourceLockOwner;
    baseVersion: number;
    now?: Date;
    ttlMs?: number;
  }): Promise<AcquireResourceLockResult> {
    const now = params.now ?? new Date();
    const candidate = createResourceLock({ ...params, now });
    const url = await this.lockUrl(params.resource);
    const body = encodeLock(candidate);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.readRecordAt(url);

      if (!current) {
        const result = await this.dav.putTextIfAbsent(url, body);
        if (result === "written") return { status: "acquired", lock: candidate };
        continue;
      }

      if (!isResourceLockExpired(current.lock, now)) {
        return { status: "locked", lock: current.lock };
      }

      const result = await this.dav.putTextIfMatch(url, body, current.etag);
      if (result === "written") return { status: "acquired", lock: candidate };
    }

    const winner = await this.readRecordAt(url);
    if (winner && !isResourceLockExpired(winner.lock, now)) {
      return { status: "locked", lock: winner.lock };
    }

    throw new Error("LOCK_ACQUIRE_RACE");
  }

  async renew(params: {
    resource: SharedResourceRef;
    leaseId: string;
    owner: Pick<ResourceLockOwner, "userId" | "deviceId">;
    now?: Date;
    ttlMs?: number;
  }): Promise<SharedResourceLock> {
    const url = await this.lockUrl(params.resource);
    const current = await this.readRecordAt(url);
    if (!current) throw new Error("LOCK_NOT_FOUND");

    const renewed = renewResourceLock({
      current: current.lock,
      leaseId: params.leaseId,
      owner: params.owner,
      now: params.now,
      ttlMs: params.ttlMs,
    });

    const result = await this.dav.putTextIfMatch(url, encodeLock(renewed), current.etag);
    if (result !== "written") throw new Error("LOCK_CHANGED");
    return renewed;
  }

  async release(params: {
    resource: SharedResourceRef;
    leaseId: string;
    owner: Pick<ResourceLockOwner, "userId" | "deviceId">;
  }): Promise<boolean> {
    const url = await this.lockUrl(params.resource);
    const current = await this.readRecordAt(url);
    if (!current) return false;

    if (!isResourceLockOwnedBy(current.lock, params.leaseId, params.owner)) {
      throw new Error("LOCK_NOT_OWNED");
    }

    const result = await this.dav.deleteIfMatch(url, current.etag);
    if (result === "precondition-failed") throw new Error("LOCK_CHANGED");
    return result === "deleted";
  }
}
