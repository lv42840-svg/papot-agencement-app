"use strict";

function hasDatabaseConfig(env = process.env) {
  return Boolean(env.PAPOT_DATABASE_URL?.trim());
}

function selectDesktopStartPath({ setupComplete, env = process.env }) {
  if (!hasDatabaseConfig(env)) return "/desktop-server-required";
  return setupComplete ? "/desktop-ready" : "/desktop-setup";
}

module.exports = {
  hasDatabaseConfig,
  selectDesktopStartPath,
};
