# PAPOT desktop local architecture

Status: accepted direction for the V1 desktop deployment. This technical note does not replace the official PAPOT AGENCEMENT cahier des charges.

## User-facing model

PAPOT is installed on each Windows workstation and launched from a normal application icon.

On the first launch only, the user completes a setup screen with:

- the shared company data/document path, for example `\\SERVEUR\\PAPOT`;
- the Nextcloud HTTPS address;
- the dedicated Nextcloud technical login;
- the Nextcloud application password;
- the PAPOT user identity for this workstation;
- a human-readable workstation name such as `PC Lucien` or `PC Nadia`.

After validation, this setup is persisted locally and is not requested on each launch.

## Secrets

The Nextcloud application password must never be written in plaintext to the normal PAPOT configuration file, committed to Git, written to the cahier des charges, or sent to the relay logs.

The desktop wrapper will store the application password using Windows-backed encrypted storage. The normal configuration stores only a logical secret reference.

## Stable workstation identity

Each installation owns a stable `device_id` UUID. Shared-resource locks therefore identify both the PAPOT user and the workstation.

Example:

- user: Lucien;
- workstation: PC Lucien;
- device id: stable UUID generated at installation.

Reinstalling PAPOT is treated as a new workstation enrollment unless an explicit recovery flow is implemented later.

## Shared resource authority

Nextcloud remains the shared synchronization authority for shared-resource files, versions and leases/locks.

The validated edit flow is:

1. read the latest resource version;
2. atomically acquire its Nextcloud lock;
3. if another active lock exists, open read-only and show its holder;
4. renew the lease while editing;
5. before save, verify the lease and expected resource version;
6. conditionally save the next version;
7. release the lease on normal close/save;
8. expired leases can be taken over safely after their TTL.

The real Nextcloud probes have already validated lock acquisition, renewal, read-only contention, release, handover and stale-version rejection.

## Shared company path

The configured Windows path is used for company documents and other files that belong on the shared storage. It must be an absolute Windows drive path or UNC path. Relative paths are rejected during setup.

Availability of that path will be tested when PAPOT starts. Loss of access must not silently redirect writes to another folder.

## Local storage

The desktop installation may keep local-only state for configuration, cache, session/device state and pending synchronization work. Shared business truth must not silently diverge into an independent per-PC copy.

The existing PostgreSQL-dependent code will be migrated deliberately rather than deleted in one large change. The final local persistence technology will be introduced behind an abstraction and verified before PostgreSQL dependencies are removed.

## Desktop wrapper choice

Target wrapper: Electron for the first Windows desktop implementation.

Reasoning:

- it can reuse the current Next.js/React application and Node-side logic with the least architectural rewrite;
- it provides direct Windows filesystem access needed for shared paths;
- it provides `safeStorage`, backed by Windows encryption facilities, for local secret encryption;
- it can package a normal Windows installer and desktop shortcut;
- it avoids exposing PAPOT as a permanently hosted public web application.

The Electron dependency and installer are introduced only after the framework-neutral first-launch configuration contract is green in tests.

## Network behavior

No inbound Internet port is required on PAPOT workstations.

PAPOT initiates outbound HTTPS to Nextcloud and, where required by mobile synchronization, the Cloudflare relay. Closing PAPOT may delay local processing until a PAPOT workstation is opened again. This is accepted for the V1 architecture.

## Next implementation steps

1. validate the local setup configuration schema and secret-exclusion tests;
2. add the Electron desktop bootstrap;
3. add Windows encrypted secret persistence;
4. add the first-launch setup UI and connection/path checks;
5. add local persistence behind an abstraction;
6. wire shared-resource lock/version state into real chantier/planning/treasury screens;
7. build and test a Windows installer on a clean workstation profile.
