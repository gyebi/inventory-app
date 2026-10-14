# Local Firebase emulator development

This workflow is isolated from staging and production. It always uses the synthetic Firebase project `demo-jyaano` and loopback-only Auth, Firestore, and Functions emulators.

## Prerequisites

- Node.js 22 and project dependencies installed with `npm install`.
- Firebase CLI installed and authenticated only if the CLI prompts for its own update checks. No Firebase project login or deployment is required for emulators.
- Java available for the Firestore emulator.

## Start a local review

In one terminal, start the emulators:

```bash
npm run emulators:start
```

In a second terminal, seed only the running local emulators and start Vite's explicit emulator mode:

```bash
npm run emulators:seed
npm run dev:emulator
```

Open the Vite URL (normally `http://127.0.0.1:5173`). The emulator UI is available at `http://127.0.0.1:4000` when Firebase starts it.

All seeded accounts use password `DemoPass!123`:

| Role | Email |
| --- | --- |
| Admin | `admin@demo.jyaano.test` |
| Manager | `manager@demo.jyaano.test` |
| Sales | `sales@demo.jyaano.test` |
| Storekeeper | `storekeeper@demo.jyaano.test` |

The seed adds those active user profiles plus one product, stock receipt, supplier, sale, categories, and tax settings. It checks that Auth, Firestore, and Functions are listening on their configured loopback ports before writing anything. Re-running it is safe and only updates its named synthetic records.

## Verify isolation

Run an ephemeral full-emulator seed and integration check:

```bash
npm run emulators:check
```

The client fails closed if emulator mode does not use `demo-jyaano`, or if any configured service is not at its designated loopback endpoint. Deployment commands explicitly reject `emulator` as a target.

## Stop the emulators

Press `Ctrl+C` in the `npm run emulators:start` terminal. This stops Auth, Firestore, Functions, and the emulator UI. Local emulator data is not exported or connected to hosted Firebase.
