import { NextcloudDavClient, type TextWithEtag } from "./nextcloud-dav";
import {
  nextSharedResourceVersion,
  sharedResourceEnvelopeSchema,
  sharedResourceRefSchema,
  type SharedResourceEnvelope,
  type SharedResourceRef,
} from "./resource-lock";

type ResourceDavClient = Pick<
  NextcloudDavClient,
  | "filesRoot"
  | "childUrl"
  | "ensurePath"
  | "getTextIfExists"
  | "getTextWithEtag"
  | "putTextIfAbsent"
  | "putTextIfMatch"
>;

type ResourceRecord = {
  envelope: SharedResourceEnvelope;
  etag: string;
};

export type SharedResourceActor = {
  userId: string;
  deviceId: string;
};

export type SharedResourceUpdateSnapshot = {
  resource: SharedResourceEnvelope | null;
  etag: string | null;
};

export type SaveSharedResourceResult =
  | { status: "saved"; resource: SharedResourceEnvelope }
  | { status: "conflict"; current: SharedResourceEnvelope | null };

function encodeEnvelope(envelope: SharedResourceEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

function parseEnvelopeText(text: string): SharedResourceEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("RESOURCE_FILE_INVALID_JSON");
  }

  const parsed = sharedResourceEnvelopeSchema.safeParse(raw);
  if (!parsed.success) throw new Error("RESOURCE_FILE_INVALID");
  return parsed.data;
}

function parseEnvelope(record: TextWithEtag): ResourceRecord {
  return {
    envelope: parseEnvelopeText(record.text),
    etag: record.etag,
  };
}

function resourceCacheKey(resource: SharedResourceRef): string {
  const parsed = sharedResourceRefSchema.parse(resource);
  return `${parsed.resource_type}:${parsed.resource_id}`;
}

export class NextcloudSharedResourceStore {
  private readonly envelopeCache = new Map<string, SharedResourceEnvelope | null>();
  private readonly inflightGets = new Map<string, Promise<SharedResourceEnvelope | null>>();

  constructor(
    private readonly dav: ResourceDavClient,
    private readonly nextcloudUserId: string,
    private readonly syncRoot = "PAPOT_SYNC",
  ) {}

  private async resourceUrl(resource: SharedResourceRef): Promise<string> {
    const parsed = sharedResourceRefSchema.parse(resource);
    const filesRoot = this.dav.filesRoot(this.nextcloudUserId);
    const collection = await this.dav.ensurePath(filesRoot, [
      this.syncRoot,
      "shared",
      parsed.resource_type.toLowerCase(),
    ]);

    return this.dav.childUrl(collection, `${parsed.resource_id}.json`);
  }

  private async readRecordAt(url: string): Promise<ResourceRecord | null> {
    const record = await this.dav.getTextWithEtag(url);
    return record ? parseEnvelope(record) : null;
  }

  getCached(resource: SharedResourceRef): SharedResourceEnvelope | null | undefined {
    return this.envelopeCache.get(resourceCacheKey(resource));
  }

  async get(resource: SharedResourceRef): Promise<SharedResourceEnvelope | null> {
    const key = resourceCacheKey(resource);
    const inflight = this.inflightGets.get(key);
    if (inflight) return inflight;

    const request = (async () => {
      const url = await this.resourceUrl(resource);
      const text = await this.dav.getTextIfExists(url);
      const envelope = text === null ? null : parseEnvelopeText(text);
      this.envelopeCache.set(key, envelope);
      return envelope;
    })();

    this.inflightGets.set(key, request);
    try {
      return await request;
    } finally {
      this.inflightGets.delete(key);
    }
  }

  async openForUpdate(resource: SharedResourceRef): Promise<SharedResourceUpdateSnapshot> {
    const url = await this.resourceUrl(resource);
    const record = await this.readRecordAt(url);
    const envelope = record?.envelope ?? null;
    this.envelopeCache.set(resourceCacheKey(resource), envelope);
    return record ? { resource: record.envelope, etag: record.etag } : { resource: null, etag: null };
  }

  async saveOpened(params: {
    resource: SharedResourceRef;
    opened: SharedResourceUpdateSnapshot;
    payload: unknown;
    actor: SharedResourceActor;
    now?: Date;
  }): Promise<SaveSharedResourceResult> {
    const expectedVersion = params.opened.resource?.version ?? 0;
    const now = params.now ?? new Date();
    const candidate = sharedResourceEnvelopeSchema.parse({
      schema_version: 1,
      resource: params.resource,
      version: nextSharedResourceVersion(expectedVersion),
      updated_at: now.toISOString(),
      updated_by_user_id: params.actor.userId,
      updated_by_device_id: params.actor.deviceId,
      payload: params.payload,
    });

    const key = resourceCacheKey(params.resource);
    const url = await this.resourceUrl(params.resource);
    const body = encodeEnvelope(candidate);
    const result =
      params.opened.etag === null
        ? await this.dav.putTextIfAbsent(url, body)
        : await this.dav.putTextIfMatch(url, body, params.opened.etag);

    if (result === "written") {
      this.envelopeCache.set(key, candidate);
      return { status: "saved", resource: candidate };
    }

    const winner = await this.readRecordAt(url);
    this.envelopeCache.set(key, winner?.envelope ?? null);
    return { status: "conflict", current: winner?.envelope ?? null };
  }

  async save(params: {
    resource: SharedResourceRef;
    expectedVersion: number;
    payload: unknown;
    actor: SharedResourceActor;
    now?: Date;
  }): Promise<SaveSharedResourceResult> {
    if (!Number.isInteger(params.expectedVersion) || params.expectedVersion < 0) {
      throw new Error("EXPECTED_VERSION_INVALID");
    }

    const opened = await this.openForUpdate(params.resource);
    const currentVersion = opened.resource?.version ?? 0;
    if (currentVersion !== params.expectedVersion) {
      return { status: "conflict", current: opened.resource };
    }

    return this.saveOpened({
      resource: params.resource,
      opened,
      payload: params.payload,
      actor: params.actor,
      now: params.now,
    });
  }
}
