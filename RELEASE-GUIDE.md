# Jyaano staging and release guide

## Current deployment behavior

`inventory-app-19d04` is the production Firebase project. Before this change, the repository had Firebase CLI scripts and live Hosting configuration, but no GitHub deployment workflow. CI runs on pushes and pull requests; it does not deploy Firebase. The controlled deployment workflow added here is manual (`workflow_dispatch`) and deploys Hosting only.

`jyaano-staging` is an active, separate Firebase project with its own Hosting
site and web app. It is not an alias for `inventory-app-19d04`. The full secure
checkout rehearsal sequence is in `docs/staging-secure-sales-rehearsal.md`.

## Local development and verification

1. Use Node 22 and run `npm ci`, then `npm run verify`.
2. Run `npm --prefix functions ci`, then `npm --prefix functions run verify`.
3. Use local `.env` only for normal development. It is ignored and must not be committed.
4. The required branch-protection check is named **Application and Functions verification**. Do not rename it without updating the GitHub ruleset.

The root test suite includes the printer authorization tests. Do not alter the deployed Ghana printer configuration during web/staging work.

## Provision staging manually

An organization/project administrator must first:

1. Confirm an available project ID and create a new Firebase/Google Cloud project; it must not be `inventory-app-19d04`.
2. Enable Firebase Authentication, Firestore, Cloud Functions, and Hosting in that project. These services are project-scoped, so staging Auth and Firestore are separate from production.
3. Register a separate staging web app and Hosting site, then create `.env.staging` from `.env.staging.example` with only staging web configuration values.
4. Set `FIREBASE_STAGING_PROJECT_ID` to the provisioned ID. `npm run build:staging` requires every value in `.env.staging` and refuses a production project ID or production domain/bucket fallback.
5. Create a staging-only Functions environment file from `functions/.env.staging.example`. It must contain only staging Hosting origins. Do not add a staging origin to production's Functions allowlist.
6. Deploy rules, Functions, and indexes to staging manually and only after reviewing their impact. Use the guarded `npm run deploy:staging:functions` and `npm run deploy:staging:firestore` commands. The GitHub workflow does not do this automatically.
7. Seed only synthetic users, products, suppliers, and sales. Never copy production customer, staff, sales, or inventory data into staging.

The local printer bridge is loopback-only and checks `INVENTORY_ALLOWED_ORIGINS`. A staging desktop requires a separate local installation/configuration with `https://jyaano-staging.web.app`; do not add that origin to the production machine’s allowlist or alter the Ghana production printer.

## Deployment controls

`npm run deploy:staging:hosting` builds with `.env.staging`, requires `FIREBASE_STAGING_PROJECT_ID`, and refuses to use the production ID. It invokes Firebase with an explicit `--project` value.

Production scripts explicitly select `inventory-app-19d04` and refuse to run unless `JYAANO_ALLOW_PRODUCTION_DEPLOY=yes` is set after approval. The GitHub workflow has separate `staging` and `production` environments; configure required reviewers on the production environment. It uses GitHub OIDC/Google Workload Identity Federation, not a committed or long-lived service-account key. Configure these GitHub environment values/secrets before dispatching it:

- `GCP_WIF_PROVIDER` secret: full Workload Identity Provider resource name.
- `FIREBASE_DEPLOYER_SERVICE_ACCOUNT` secret: deployment service-account email.
- `FIREBASE_STAGING_WEB_ENV` secret: complete staging `.env` content.
- `FIREBASE_PRODUCTION_WEB_ENV` secret: complete production `.env` content.
- `FIREBASE_STAGING_PROJECT_ID` environment variable: provisioned staging project ID.

Grant the federated service account only the Firebase/Hosting permissions required for the selected project. Use separate staging and production service accounts where possible. The workflow deploys Hosting only: it never deploys Firestore rules or Functions automatically to production.

## Smoke-test layers

- Unit/static: root configuration tests verify staging target rejection, inventory/sales entrypoint presence, deployment guards, and printer origin configuration. Functions tests cover callable initialization and authorization with mocks.
- Emulator: `npm run smoke:emulator` starts Firestore with the explicit synthetic project `jyaano-emulator-smoke`, performs no write, and expects unauthenticated access to be denied by rules. It cannot target production.
- Actual staging: after provisioning, build/deploy staging Hosting and manually verify app initialization, sign-in rejection/acceptance boundaries with synthetic accounts, Firestore access, callable authorization, Inventory, Sales, and a separately configured printer bridge.

## Release, rollback, and recovery

1. Use feature branches and pull requests; wait for **Application and Functions verification**.
2. Deploy and smoke-test staging explicitly before considering production.
3. Dispatch the production Hosting workflow only from `main` and only after protected-environment approval.
4. Firebase Hosting can roll back to a prior Hosting release in the Firebase console or by redeploying the previous approved artifact. Confirm the selected site/project first.
5. Functions and Firestore rules do not have an equivalent one-click application rollback. Roll them back by deploying a reviewed previous revision; assess compatibility and data effects before doing so.

Recovery status is limited: a production Firestore export completed successfully, and an encrypted Firebase Authentication export exists. A full staging restoration has not been proven. Backup retention and scheduling are not yet automated, and Firebase password-hash recovery may require separate handling. Before a production release, verify the export location, access controls, restore procedure, Auth import/hash requirements, and a staging restore drill. Do not describe the current backup posture as disaster-recovery tested.
