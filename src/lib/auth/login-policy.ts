export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_IP_MAX_ATTEMPTS = 50;

export type LoginState = {
  failures: number;
  firstFailureAt: number | null;
  blockedUntil: number | null;
  lockCycles: number;
  requiresAdminReset: boolean;
};

export function emptyLoginState(): LoginState {
  return {
    failures: 0,
    firstFailureAt: null,
    blockedUntil: null,
    lockCycles: 0,
    requiresAdminReset: false,
  };
}

export function loginBlock(etat: LoginState, maintenant: number) {
  if (etat.requiresAdminReset) return "admin_reset_required" as const;
  if (etat.blockedUntil !== null && etat.blockedUntil > maintenant) {
    return "temporary" as const;
  }
  return "allowed" as const;
}

export function failedLogin(etat: LoginState, maintenant: number): LoginState {
  if (loginBlock(etat, maintenant) !== "allowed") return { ...etat };
  const expire =
    etat.firstFailureAt === null || maintenant - etat.firstFailureAt >= LOGIN_WINDOW_MS;
  const echecs = expire ? 1 : etat.failures + 1;
  const resultat: LoginState = {
    ...etat,
    failures: echecs,
    firstFailureAt: expire ? maintenant : etat.firstFailureAt,
    blockedUntil: null,
  };
  if (echecs >= LOGIN_MAX_FAILURES) {
    resultat.lockCycles += 1;
    resultat.requiresAdminReset = resultat.lockCycles >= 2;
    resultat.blockedUntil = maintenant + LOGIN_WINDOW_MS;
  }
  return resultat;
}
