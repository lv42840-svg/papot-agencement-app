import { randomUUID } from "node:crypto";

const DEFAULT_BASE_URL = "https://cloud.ideo-solutions.com";
const DEFAULT_SYNC_ROOT = "PAPOT_SYNC";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. Configure it locally; do not commit the real value.`);
  }
  return value;
}

function joinUrl(base: string, ...parts: string[]): string {
  return [
    base.replace(/\/+$/, ""),
    ...parts.map((part) => part.replace(/^\/+|\/+$/g, "")),
  ].join("/");
}

function basicAuth(login: string, appPassword: string): string {
  return `Basic ${Buffer.from(`${login}:${appPassword}`, "utf8").toString("base64")}`;
}

type RequestOptions = {
  body?: BodyInit;
  headers?: Record<string, string>;
  expected: number[];
  label: string;
};

async function davRequest(
  method: string,
  url: string,
  authorization: string,
  options: RequestOptions,
): Promise<Response> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: authorization,
      "User-Agent": "PAPOT-Nextcloud-Probe/0.1",
      ...options.headers,
    },
    body: options.body,
  });

  if (!options.expected.includes(response.status)) {
    throw new Error(`${options.label} failed with HTTP ${response.status}`);
  }

  console.log(`[ok] ${options.label}: HTTP ${response.status}`);
  return response;
}

async function discoverUserId(baseUrl: string, authorization: string): Promise<string> {
  const response = await fetch(`${baseUrl}/ocs/v2.php/cloud/user?format=json`, {
    headers: {
      Authorization: authorization,
      "OCS-APIRequest": "true",
      Accept: "application/json",
      "User-Agent": "PAPOT-Nextcloud-Probe/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Nextcloud user discovery failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    ocs?: { data?: { id?: unknown } };
  };
  const userId = body.ocs?.data?.id;
  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("Nextcloud user discovery did not return a usable canonical user id");
  }

  console.log("[ok] Nextcloud canonical user id discovered without assuming the login name");
  return userId;
}

async function main() {
  const baseUrl = (process.env.NEXTCLOUD_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const login = requiredEnv("NEXTCLOUD_LOGIN");
  const appPassword = requiredEnv("NEXTCLOUD_APP_PASSWORD");
  const syncRoot = process.env.NEXTCLOUD_SYNC_ROOT?.trim() || DEFAULT_SYNC_ROOT;
  const authorization = basicAuth(login, appPassword);
  const userId = await discoverUserId(baseUrl, authorization);
  const filesRoot = joinUrl(baseUrl, "remote.php/dav/files", encodeURIComponent(userId));
  const syncRootUrl = joinUrl(filesRoot, encodeURIComponent(syncRoot));
  const probeId = randomUUID();
  const probeDirUrl = joinUrl(syncRootUrl, `.papot-probe-${probeId}`);
  const partUrl = joinUrl(probeDirUrl, `${probeId}.part`);
  const finalUrl = joinUrl(probeDirUrl, `${probeId}.json`);
  const fixedPayload = `papot-nextcloud-probe:${probeId}\n`;
  let probeDirectoryCreated = false;

  console.log(`[info] Testing WebDAV path: ${new URL(filesRoot).pathname}/`);

  try {
    await davRequest("PROPFIND", `${filesRoot}/`, authorization, {
      expected: [207],
      headers: { Depth: "0" },
      label: "PROPFIND files root",
    });

    const rootProbe = await fetch(`${syncRootUrl}/`, {
      method: "PROPFIND",
      headers: {
        Authorization: authorization,
        "User-Agent": "PAPOT-Nextcloud-Probe/0.1",
        Depth: "0",
      },
    });

    if (rootProbe.status === 404) {
      await davRequest("MKCOL", syncRootUrl, authorization, {
        expected: [201],
        label: `MKCOL ${syncRoot}`,
      });
    } else if (rootProbe.status === 207) {
      console.log(`[ok] PROPFIND ${syncRoot}: HTTP 207`);
    } else {
      throw new Error(`PROPFIND ${syncRoot} failed with HTTP ${rootProbe.status}`);
    }

    await davRequest("MKCOL", probeDirUrl, authorization, {
      expected: [201],
      label: "MKCOL probe directory",
    });
    probeDirectoryCreated = true;

    await davRequest("PUT", partUrl, authorization, {
      body: fixedPayload,
      expected: [201, 204],
      headers: { "Content-Type": "application/octet-stream" },
      label: "PUT temporary .part file",
    });

    const partResponse = await davRequest("GET", partUrl, authorization, {
      expected: [200],
      label: "GET temporary .part file",
    });
    if ((await partResponse.text()) !== fixedPayload) {
      throw new Error("GET temporary .part file returned different content");
    }
    console.log("[ok] Temporary file content integrity verified");

    await davRequest("MOVE", partUrl, authorization, {
      expected: [201, 204],
      headers: {
        Destination: finalUrl,
        Overwrite: "F",
      },
      label: "MOVE .part to finalized .json",
    });

    await davRequest("PROPFIND", finalUrl, authorization, {
      expected: [207],
      headers: { Depth: "0" },
      label: "PROPFIND finalized .json",
    });

    const finalResponse = await davRequest("GET", finalUrl, authorization, {
      expected: [200],
      label: "GET finalized .json",
    });
    if ((await finalResponse.text()) !== fixedPayload) {
      throw new Error("GET finalized .json returned different content");
    }
    console.log("[ok] Final file content integrity verified");

    await davRequest("DELETE", finalUrl, authorization, {
      expected: [204],
      label: "DELETE finalized test file",
    });

    console.log("[pass] Real Nextcloud WebDAV file-operation probe completed");
  } finally {
    if (probeDirectoryCreated) {
      const cleanup = await fetch(probeDirUrl, {
        method: "DELETE",
        headers: {
          Authorization: authorization,
          "User-Agent": "PAPOT-Nextcloud-Probe/0.1",
        },
      }).catch(() => null);
      if (cleanup && (cleanup.status === 204 || cleanup.status === 404)) {
        console.log(`[ok] Probe directory cleanup: HTTP ${cleanup.status}`);
      } else if (cleanup) {
        console.warn(`[warn] Probe directory cleanup returned HTTP ${cleanup.status}`);
      } else {
        console.warn("[warn] Probe directory cleanup could not be completed");
      }
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown failure";
  console.error(`[fail] ${message}`);
  process.exitCode = 1;
});
