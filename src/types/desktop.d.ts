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
        papotUserDisplayName: string;
      }) => Promise<
        | {
            ok: true;
            config: {
              deviceId: string;
              deviceLabel: string;
              nextcloudUserId: string;
              papotUserDisplayName: string;
              sharedDataPath: string;
            };
          }
        | { ok: false; error: string }
      >;
      finishSetup: () => Promise<{ ok: boolean }>;
    };
  }
}
