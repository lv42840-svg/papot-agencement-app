export {};

declare global {
  interface Window {
    papotDesktop?: {
      openBusinessFolder: (input: {
        kind: "commercial-case";
        storagePath: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      openBusinessFile: (input: {
        kind: "commercial-document";
        storagePath: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      composeOutlookMail: (input: {
        kind: "quote-email";
        to: string;
        subject: string;
        body: string;
        storagePath: string;
      }) => Promise<{ ok: boolean; error?: string; attachmentAttached?: boolean }>;
    };
  }
}
