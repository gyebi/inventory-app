# Jyaano V1.5 dependency security review

Reviewed: 2026-10-12

## Resolution applied

The root lockfile now resolves the existing `firebase` dependency range (`^12.12.1`) to the latest compatible Firebase 12 release:

| Package | Previous resolution | Current resolution |
| --- | ---: | ---: |
| `firebase` | 12.12.1 | 12.19.0 |
| `@firebase/firestore` | 4.14.0 | 4.17.2 |
| `@firebase/firestore-compat` | 0.4.8 | 0.4.14 |
| `@grpc/grpc-js` | 1.9.16 | 1.9.16 |

This was a lockfile-only supported maintenance update; `package.json` and application code were not changed.

## Remaining audit findings

The starting dependency update reduced the root audit from 8 findings to 4 high findings. Both `npm audit` and `npm audit --omit=dev` report the same four entries after this update: `firebase`, `@firebase/firestore-compat`, `@firebase/firestore`, and the underlying `@grpc/grpc-js@1.9.16`.

The underlying advisories are:

- `GHSA-m9gg-hp2v-232j`: certificate authorization returned by `getAuthContext` in certain gRPC configurations (high; fixed in gRPC 1.13.6).
- `GHSA-f596-whhp-79r4`: server handler error details can be returned in status messages (low; included in the audit path reported as high through Firebase).

Firebase 12.19.0 uses Firestore 4.17.2. Its published dependency range remains `@grpc/grpc-js: ~1.9.0`. The later Firestore 4.18.0 and Firebase 13.0.0 package metadata were also checked and retain that same range. Consequently, no currently published supported Firebase/Firestore update moves gRPC to the fixed 1.13.6-or-newer line.

An npm `overrides` entry for gRPC 1.13.6 or 1.14.6 would violate Firestore's `~1.9.0` range. It was deliberately not added: it would silence the audit at the cost of running an untested, unsupported dependency combination. `npm audit fix --force` was not used; its offered Firebase 9.14.0 change is a downgrade and not an acceptable remediation.

## Exposure assessment

Jyaano imports the Firebase browser SDK from `js/`. Firestore's package export maps the browser build to `dist/index.esm.js`; the Node builds (`dist/index.node.cjs.js` and `dist/index.node.mjs`) are the only Firestore entry points that import `@grpc/grpc-js`.

The post-update Vite production build was scanned without source maps. It contains no `@grpc/grpc-js`, `grpc-js`, `node:net`, `node:tls`, or `node:http2` marker. The vulnerable gRPC code is therefore present in the root installation/lockfile solely for Firestore's Node-specific path and is not included in the browser production bundle.

The separately deployed `functions/` project does not import the root Firebase web SDK and has an independent lockfile. Its remediation is documented below; no Functions deployment occurred during either review.

Residual risk is limited to a future use of the root dependency tree in a Node runtime that loads Firestore's Node entry point. If that usage is introduced, reassess the gRPC dependency immediately. Continue to monitor Firebase/Firestore releases for an officially supported gRPC range at or above 1.13.6.

## Validation and limits

- `npm ls` confirmed Firebase 12.19.0, Firestore 4.17.2, and gRPC 1.9.16 in the root tree.
- `npm audit` and `npm audit --omit=dev` were run after the update; each reports 4 high findings as described above.
- `npm run verify` was run after installing from the updated lockfile.
- The production bundle was rebuilt and scanned for the Node/gRPC transport markers noted above.
- No Firebase API, Firestore read/write, Authentication operation, emulator operation, deployment, rule change, or production-data operation was performed. The validation demonstrates package/build compatibility only; it cannot prove behavior against a live Firebase project.

## Cloud Functions dependency remediation

The Functions package is a Node 22 Firebase backend with a separate dependency lockfile. Before remediation, both `npm --prefix functions audit` and `npm --prefix functions audit --omit=dev` reported 20 production findings: 2 critical, 7 high, 9 moderate, and 2 low. The chains included `firebase-admin@12.7.0`, `firebase-functions@6.6.0`, gRPC 1.14.3, Express 4 dependencies, protobufjs, Google Cloud Firestore/Storage, and their HTTP dependencies.

| Package | Previous resolution | Current resolution |
| --- | ---: | ---: |
| `firebase-admin` | 12.7.0 | 14.5.0 |
| `firebase-functions` | 6.6.0 | 7.4.0 |
| `@grpc/grpc-js` | 1.14.3 | 1.14.6 |
| `@google-cloud/firestore` | 7.11.6 | 9.3.1 |
| `@google-cloud/storage` | 7.19.0 | 8.4.0 |
| `protobufjs` | 7.5.5 | 7.6.6 |

First, a non-forced `npm audit fix` updated supported transitive packages. Nine findings remained through Firebase Admin 12, for which npm identified Admin 14.5.0 as the supported remediation. Admin 14 requires Node 22 and Firebase Functions 6 only peers through Admin 13, so Firebase Functions was upgraded in tandem to 7.4.0, whose published peer range explicitly supports Admin 14 and whose Node requirement is `>=18`. Both direct dependencies are pinned to these tested versions. `npm audit fix --force` and dependency overrides were not used.

Admin 14 removes the legacy `admin.firestore()` and `admin.auth()` namespace calls used by this codebase. `functions/index.js` was changed only to use the equivalent modular Admin APIs: `initializeApp`, `getFirestore`, `getAuth`, and `FieldValue`. Callable behavior, data fields, authorization decisions, and Firestore operations were otherwise preserved.

After the upgrade, both Functions audit scopes report 0 findings. This is a point-in-time dependency assessment, not a claim of complete backend security clearance.

### Backend verification and remaining risk

`npm --prefix functions run verify` now performs JavaScript static parsing, focused callable-function tests, and a real module-load smoke test against the installed Firebase packages. The mock tests do not connect to Firebase and cover unauthenticated rejection for all callables, non-admin staff-creation rejection, invalid role and password-setup-origin rejection before Auth creation, authorized temporary-password staff creation, and self-only password-change-flag updates.

CI runs clean `npm ci` and `npm run verify` for both the root application and `functions/`, under Node 22, without Firebase credentials. It uses a real static check instead of the previous placeholder lint command.

A controlled in-memory `node:test` failure was executed during this review and exited nonzero; the temporary regression was not written to the repository. This confirms the test runner used by the Functions verification propagates backend test failures to CI.

No emulator or live Firebase operation was run. In particular, the existing `clearRequiredPasswordChange` callable accepts any authenticated user and clears that caller's flag; it does not independently prove a password was changed. A caller can invoke the callable directly, so enforcing a mandatory password rotation requires a separately designed server-verifiable credential-change flow. This pre-existing authorization limitation is documented but not altered here because it affects user-account business behavior and cannot be safely fixed by a dependency-only change.
