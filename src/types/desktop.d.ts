export {};

declare global {
  interface Window {
    papotDesktop?: {
      saveSetup: (input: {
        sharedDataPath: string;
        nextcloudBaseUrl: string;
        nextcloudLogin: string;
        nextcloudAppPassword: string;
        deviceLabel: string;
      }) => Promise<
        | {
            ok: true;
            config: {
              deviceId: string;
              deviceLabel: string;
              nextcloudUserId: string;
              sharedDataPath: string;
            };
          }
        | { ok: false; error: string }
      >;
      finishSetup: () => Promise<{ ok: boolean }>;
      openBusinessFolder: (input: {
        kind: "commercial-case";
        caseId: string;
        creationYear: number;
      }) => Promise<{ ok: true } | { ok: false; error: string }>;
    };
  }
}
