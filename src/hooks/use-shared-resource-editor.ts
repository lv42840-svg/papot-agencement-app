"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SharedResourceRef } from "@/lib/sync/resource-lock";

type EditorAccess = {
  status: "editable" | "read-only";
  version: number;
  ownerDisplayName?: string;
};

type SharedResourceEditorOptions<Payload> = {
  resource: SharedResourceRef;
  emptyPayload: Payload;
  openingMessage: string;
  openedMessage?: string;
  savedMessage: string;
};

const endpoint = "/api/desktop/shared-resource";

export function useSharedResourceEditor<Payload>(
  options: SharedResourceEditorOptions<Payload>,
) {
  const optionsRef = useRef(options);
  const resource = useRef(options.resource);
  const leaseId = useRef(crypto.randomUUID());
  const editable = useRef(false);
  const [access, setAccess] = useState<EditorAccess | null>(null);
  const [payload, setPayload] = useState<Payload>(options.emptyPayload);
  const [message, setMessage] = useState(options.openingMessage);

  const call = useCallback(
    (body: unknown) =>
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    [],
  );

  useEffect(() => {
    let active = true;
    const currentLeaseId = leaseId.current;
    const currentResource = resource.current;

    call({ action: "open", resource: currentResource, leaseId: currentLeaseId })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Ouverture impossible");
        if (!active) return;
        setPayload((result.resource?.payload as Payload | undefined) ?? optionsRef.current.emptyPayload);
        setAccess({
          status: result.status,
          version: result.baseVersion,
          ownerDisplayName:
            result.status === "read-only" ? result.lock.owner_display_name : undefined,
        });
        editable.current = result.status === "editable";
        setMessage(optionsRef.current.openedMessage ?? "");
      })
      .catch(
        (error) =>
          active && setMessage(error instanceof Error ? error.message : "Ouverture impossible"),
      );

    const renewal = window.setInterval(() => {
      if (!editable.current) return;
      void call({ action: "renew", resource: currentResource, leaseId: currentLeaseId });
    }, 120_000);

    return () => {
      active = false;
      window.clearInterval(renewal);
      if (editable.current) {
        navigator.sendBeacon(
          endpoint,
          new Blob(
            [
              JSON.stringify({
                action: "release",
                resource: currentResource,
                leaseId: currentLeaseId,
              }),
            ],
            { type: "application/json" },
          ),
        );
      }
    };
  }, [call]);

  const save = useCallback(
    async (nextPayload: Payload) => {
      if (!access || access.status !== "editable") return false;
      setMessage("Enregistrement…");
      const response = await call({
        action: "save",
        resource: resource.current,
        leaseId: leaseId.current,
        expectedVersion: access.version,
        payload: nextPayload,
      });
      const result = await response.json();
      if (!response.ok || result.status === "conflict") {
        setMessage("Cet élément a changé ailleurs. Rechargez-le avant de poursuivre.");
        return false;
      }
      setAccess({ status: "editable", version: result.resource.version });
      setPayload(nextPayload);
      setMessage(optionsRef.current.savedMessage);
      return true;
    },
    [access, call],
  );

  return {
    access,
    canEdit: access?.status === "editable",
    message,
    payload,
    save,
    setPayload,
  };
}
