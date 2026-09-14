export type DesktopDatabaseEnv = Record<string, string | undefined>;

export function hasDesktopDatabaseConfig(env: DesktopDatabaseEnv = process.env): boolean {
  return Boolean(env.PAPOT_DATABASE_URL?.trim());
}
