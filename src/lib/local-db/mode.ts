export function isLocalStorageMode(): boolean {
  return (process.env.PAPOT_STORAGE_MODE ?? "local").toLowerCase() === "local";
}
