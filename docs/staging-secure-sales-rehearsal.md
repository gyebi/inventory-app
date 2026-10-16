# Secure-sales staging rehearsal

This is a staging-only checkout rehearsal for `jyaano-staging`. It does not
authorize a production rollout, production data copy, or a receiving/adjustment
cutover.

## Preconditions

- The checkout, Functions, rules, and Hosting changes are merged in a reviewed
  commit and both verification suites plus emulator integrations pass.
- `FIREBASE_STAGING_PROJECT_ID=jyaano-staging`; never substitute
  `inventory-app-19d04`.
- `.env.staging` contains the existing staging web-app configuration only.
- `functions/.env.jyaano-staging` is an ignored local file created from
  `functions/.env.staging.example`, with exactly:

  ```dotenv
  JYAANO_DEPLOYMENT_ENV=staging
  FUNCTIONS_ALLOWED_ORIGINS=https://jyaano-staging.web.app,https://jyaano-staging.firebaseapp.com
  ```

  Firebase Functions loads project-specific dotenv files by project ID. Do not
  use the production file or add either staging origin to production Functions.

- The deployer has Functions, Firestore Rules, Firestore Index Admin, Artifact
  Registry, Cloud Run, Eventarc, Service Account User, and Hosting permissions
  in staging. The existing GitHub deployer has Hosting Admin only, so this
  rehearsal must use an authorized human operator until its IAM is expanded.

## Ordered deployment

Run from the repository root with Node 22 and a Firebase CLI authenticated only
for the staging project:

```bash
export FIREBASE_STAGING_PROJECT_ID=jyaano-staging
test "$FIREBASE_STAGING_PROJECT_ID" = jyaano-staging
test -f .env.staging
test -f functions/.env.jyaano-staging
npm run verify
npm --prefix functions run verify
npm run emulators:check
npm run emulators:secure-sales

# Deploy the callable implementation first. This includes quoteSecureSale and submitSecureSale.
npm run deploy:staging:functions

# Deploy the secure-mode denial rules and the checked-in index definition together.
npm run deploy:staging:firestore

# Build an artifact pinned to staging, then deploy only that artifact.
npm run deploy:staging:hosting
```

`firestore.indexes.json` currently declares no composite indexes. The secure
batch lookup uses Firestore's automatic single-field `productId` index; deploying
the index definition still keeps staging aligned with source control.

Do not run any production deploy command or set `JYAANO_ALLOW_PRODUCTION_DEPLOY`.
The production `settings/secureSales` document must remain absent or have
`enabled: false`.

## Synthetic fixture and enablement

After Functions and rules are live, create only the named staging rehearsal
fixtures. This command is intentionally rejected for every project other than
the emulator project and `jyaano-staging`.

```bash
export GCLOUD_PROJECT=jyaano-staging
export JYAANO_ALLOW_SYNTHETIC_STAGING=true
export JYAANO_SYNTHETIC_STAGING_PASSWORD='use-a-unique-12-plus-character-secret'
npm --prefix functions run seed:secure-rehearsal
unset JYAANO_SYNTHETIC_STAGING_PASSWORD
```

It creates or reuses only `synthetic-secure-sales-rehearsal` documents and an
Auth/Firestore sales user of the same synthetic name. Existing synthetic stock
is preserved rather than reset after a sale. The command then enables
`settings/secureSales` in staging with `rehearsalOnly: true`; it never enables
production secure sales.

Run the dry reconciliation before the browser rehearsal:

```bash
GCLOUD_PROJECT=jyaano-staging \
JYAANO_ALLOW_SYNTHETIC_STAGING=true \
JYAANO_RECONCILIATION_DRY_RUN=true \
npm --prefix functions run reconcile:secure
```

Sign in as the synthetic sales user and verify the server quote, tax breakdown,
stale-quote renewal, idempotent retry, and immutable receipt unit label. Do not
copy production users, inventory, sales, suppliers, receipts, or Auth records.

## Explicit operational limits

With secure sales enabled, legacy client receiving, stock adjustment, product
stock mutation, and stock-receipt writes are intentionally denied. Returns are
also not implemented as server-authoritative batch transactions. This rehearsal
therefore proves checkout only; it is not a complete operational inventory
rollout. Disable staging secure sales before using any of those legacy workflows,
or wait for server-authoritative receiving, returns, and adjustments.

## Linux printer rehearsal

Inspect the staging desktop's existing RFCOMM binding and bridge first. Use a
separate staging desktop and test printer; do not run these commands on the
Ghana production desktop or change its origin/printer configuration.

```bash
cd printer-bridge/deployment
./install-linux.sh --mac <STAGING_TEST_PRINTER_MAC> --channel 1 \
  --origin https://jyaano-staging.web.app --dry-run
```

Only after an approved test window, install on that staging desktop with the
same command without `--dry-run`, then verify the loopback bridge and print a
physical synthetic receipt:

```bash
curl -sS -H 'Origin: https://jyaano-staging.web.app' http://127.0.0.1:17820/status
curl -sS -X POST -H 'Origin: https://jyaano-staging.web.app' http://127.0.0.1:17820/test-print
```

The production bridge keeps its existing production-only allowlist unchanged.
