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

export type SaveSharedResourceResult =
  | { status: "saved"; resource: SharedResourceEnvelope }
  | { status: "conflict"; current: SharedResourceEnvelope | null };

function encodeEnvelope(envelope: SharedResourceEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

function parseEnvelope(record: TextWithEtag): ResourceRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(record.text);
  } catch {
    throw new Error("RESOURCE_FILE_INVALID_JSON");
  }

  const parsed = sharedResourceEnvelopeSchema.safeParse(raw);
  if (!parsed.success) throw new Error("RESOURCE_FILE_INVALID");

  return {
    envelope: parsed.data,
    etag: record.etag,
  };
}

export class NextcloudSharedResourceStore {
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

  async get(resource: SharedResourceRef): Promise<SharedResourceEnvelope | null> {
    const url = await this.resourceUrl(resource);
    const record = await this.readRecordAt(url);
    return record?.envelope ?? null;
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

    const now = params.now ?? new Date();
    const nextVersion = nextSharedResourceVersion(params.expectedVersion);
    const candidate = sharedResourceEnvelopeSchema.parse({
      schema_version: 1,
      resource: params.resource,
      version: nextVersion,
      updated_at: now.toISOString(),
      updated_by_user_id: params.actor.userId,
      updated_by_device_id: params.actor.deviceId,
      payload: params.payload,
    });

    const url = await this.resourceUrl(params.resource);
    const body = encodeEnvelope(candidate);
    const current = await this.readRecordAt(url);

    if (!current) {
      if (params.expectedVersion !== 0) {
        return { status: "conflict", current: null };
      }

      const result = await this.dav.putTextIfAbsent(url, body);
      if (result === "written") {
        return { status: "saved", resource: candidate };
      }

      const winner = await this.readRecordAt(url);
      return { status: "conflict", current: winner?.envelope ?? null };
    }

    if (current.envelope.version !== params.expectedVersion) {
      return { status: "conflict", current: current.envelope };
    }

    const result = await this.dav.putTextIfMatch(url, body, current.etag);
    if (result === "written") {
      return { status: "saved", resource: candidate };
    }

    const winner = await this.readRecordAt(url);
    return { status: "conflict", current: winner?.envelope ?? null };
  }
}
