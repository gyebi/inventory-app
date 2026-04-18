# Progress

## Current State

The project is now running as a browser-based inventory and sales app with:

- role-aware login data in state
- batch-level stock tracking
- expiry-aware sales checks
- receipt generation
- `Ghs` currency formatting in key UI areas
- Vite added as the dev/build tool

## Completed

- Added seeded users and role-based auth groundwork
- Added permission helpers in the auth layer
- Introduced stable product IDs
- Added richer sale objects with:
  - `id`
  - `items`
  - `totalAmount`
  - `profit`
  - `createdAt`
  - `createdBy`
- Added batch-level stock storage
- Added expiry date capture during stock receipt
- Prevented sales from expired stock
- Allocated sales from unexpired batches
- Added receipt rendering with:
  - business name
  - receipt ID
  - cashier name
  - date/time
  - purchased items
  - totals
- Updated branding to `CALKRIS-DARF VENTURES`
- Added `Ghs` formatting to receipts, inventory, and dashboard
- Added Vite tooling with:
  - `npm run dev`
  - `npm run build`
  - `npm run preview`

## Partially Done

- Vite integration works for dev preview, but the app is still using global scripts instead of a true module entry
- `salesService.js` exists, but the live sales page still creates sales directly instead of delegating to the service
- Modular architecture exists in parts, but the running app still depends heavily on globals

## Known Gaps

- Vite production build is not yet fully aligned with the current script-loading model
- `tmp/` contains scaffold leftovers from the Vite bootstrap
- Router/module structure is not yet the live execution path
- Some service files are still scaffolding and are not yet driving the UI

## Next Recommended Steps

1. Create a proper Vite module entry point
2. Move the live sales page to use `js/services/salesService.js`
3. Move receipt calls to flow from the service-created sale object
4. Remove temporary scaffold leftovers in `tmp/`
5. Continue migrating global page logic into services/router/state modules

## Preview

To run the current app:

```bash
npm run dev
```

Then open:

```text
http://127.0.0.1:4173/
```
