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

export function loginBlock(state: LoginState, now: number) {
  if (state.requiresAdminReset) return "admin_reset_required" as const;
  if (state.blockedUntil !== null && state.blockedUntil > now) return "temporary" as const;
  return "allowed" as const;
}

export function failedLogin(state: LoginState, now: number): LoginState {
  if (loginBlock(state, now) !== "allowed") return { ...state };
  const expired = state.firstFailureAt === null || now - state.firstFailureAt >= LOGIN_WINDOW_MS;
  const failures = expired ? 1 : state.failures + 1;
  const result: LoginState = {
    ...state,
    failures,
    firstFailureAt: expired ? now : state.firstFailureAt,
    blockedUntil: null,
  };
  if (failures >= LOGIN_MAX_FAILURES) {
    result.lockCycles += 1;
    result.requiresAdminReset = result.lockCycles >= 2;
    result.blockedUntil = now + LOGIN_WINDOW_MS;
  }
  return result;
}
