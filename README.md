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

Current callable backend functions:

- `createStaffUser`
- `ensureSignedInUserProfile`
- `clearRequiredPasswordChange`

Notes:

- on a brand-new project with an empty `users` collection, the first signed-in Firebase Auth user is bootstrapped as `admin`
- after that first bootstrap, every additional user must have a staff profile created by an admin
- the app currently supports a temporary legacy login fallback while Firebase Auth migration is in progress
