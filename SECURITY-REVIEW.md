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

The separately deployed `functions/` project does not import the root Firebase web SDK, and it has an independent lockfile. It was not part of the stated root-package 8-to-4 audit scope and was not changed or deployed by this review. A read-only `npm --prefix functions audit --omit=dev` check reports 20 existing findings (2 critical, 7 high, 9 moderate, and 2 low), including newer gRPC advisories affecting its locked gRPC 1.14.3. Those findings require a separately scoped Functions dependency review and are not remediated by this root-browser SDK update.

Residual risk is limited to a future use of the root dependency tree in a Node runtime that loads Firestore's Node entry point. If that usage is introduced, reassess the gRPC dependency immediately. Continue to monitor Firebase/Firestore releases for an officially supported gRPC range at or above 1.13.6.

## Validation and limits

- `npm ls` confirmed Firebase 12.19.0, Firestore 4.17.2, and gRPC 1.9.16 in the root tree.
- `npm audit` and `npm audit --omit=dev` were run after the update; each reports 4 high findings as described above.
- The separate Cloud Functions audit was inspected read-only only; its 20 findings are outside this change's root-package scope and remain a release-risk consideration for any Functions deployment.
- `npm run verify` was run after installing from the updated lockfile.
- The production bundle was rebuilt and scanned for the Node/gRPC transport markers noted above.
- No Firebase API, Firestore read/write, Authentication operation, emulator operation, deployment, rule change, or production-data operation was performed. The validation demonstrates package/build compatibility only; it cannot prove behavior against a live Firebase project.
