export {};

declare global {
  interface Window {
    papotDesktop?: {
      openBusinessFolder: (input: {
        storagePath?: string;
        creationYear?: number;
        clientName?: string | null;
        caseName?: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      openBusinessFile: (input: {
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
