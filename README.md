# inventory-app

## App

```bash
npm run dev
```

```bash
npm run build
```

## Firebase Backend

Install Functions dependencies:

```bash
cd functions
npm install
```

Deploy Firestore rules:

```bash
npm run deploy:rules
```

Deploy Cloud Functions:

```bash
npm run deploy:functions
```

See [RELEASE-GUIDE.md](RELEASE-GUIDE.md) for staging setup, guarded deployment commands, GitHub OIDC configuration, smoke tests, rollback, and recovery limitations.

## Local Firebase emulator development

Use the isolated `demo-jyaano` project for local review. It uses synthetic accounts and only loopback endpoints; it does not read or write hosted Firebase projects. See [the local emulator workflow](docs/local-emulator-development.md) for prerequisites, commands, demo accounts, and shutdown instructions.

## Receipt printing

For Windows local receipt-printer setup, diagnostics, bridge error codes, and physical-hardware validation, see [Windows receipt printing](docs/windows-receipt-printing.md). The existing Linux MPT-II Bluetooth/RFCOMM deployment guide remains in `printer-bridge/deployment/README.md`.

Current callable backend functions:

- `createStaffUser`
- `ensureSignedInUserProfile`
- `clearRequiredPasswordChange`

Notes:

- on a brand-new project with an empty `users` collection, the first signed-in Firebase Auth user is bootstrapped as `admin`
- after that first bootstrap, every additional user must have a staff profile created by an admin
- the app currently supports a temporary legacy login fallback while Firebase Auth migration is in progress
