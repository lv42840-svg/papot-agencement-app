export const accentPalette = {
  lavender: { label: "Lavande", value: "#7666D6", foreground: "#FFFFFF" },
  blue: { label: "Bleu", value: "#3569B8", foreground: "#FFFFFF" },
  teal: { label: "Sauge", value: "#2E756B", foreground: "#FFFFFF" },
  bronze: { label: "Bronze", value: "#8A6A3C", foreground: "#FFFFFF" },
  graphite: { label: "Graphite", value: "#505664", foreground: "#FFFFFF" },
} as const;

export type AccentKey = keyof typeof accentPalette;

export function isAccentKey(value: string): value is AccentKey {
  return value in accentPalette;
}
