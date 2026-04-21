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

Current callable backend function:

- `createStaffUser`

Notes:

- the app currently supports a temporary legacy login fallback while Firebase Auth migration is in progress
- the staff page will try the secure backend function first, then fall back to a Firestore profile-only save if the function is not deployed yet
