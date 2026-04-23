# Backup and Recovery Document

## Project Overview

This project is a Vite-powered JavaScript single-page application deployed on Firebase Hosting and backed by Firebase services. The application currently uses:

- Firebase Authentication for user sign-in
- Cloud Firestore for operational data
- Firebase Cloud Functions for staff account provisioning and profile maintenance
- Firebase Hosting for frontend deployment
- Local browser storage as a limited client-side persistence layer

The main Firestore collections in active use are:

- `users`
- `products`
- `sales`
- `stockReceipts`
- `suppliers`

## Purpose

This document defines how application data and deployment assets should be backed up and how the system should be restored after accidental deletion, corruption, misconfiguration, or service disruption.

## Backup Scope

The following assets are in scope for backup and recovery:

### 1. Firestore Data

Primary business data stored in Firestore:

- User profiles and roles in `users`
- Product catalog and stock levels in `products`
- Sales records in `sales`
- Stock receiving history in `stockReceipts`
- Supplier records in `suppliers`

### 2. Firebase Authentication

Authentication records for staff users, including:

- User accounts
- Email addresses
- Account status

Note: Firebase Auth records are separate from Firestore `users` documents. Both must be considered during recovery.

### 3. Cloud Functions

Server-side callable functions in `functions/index.js`, including:

- `createStaffUser`
- `ensureSignedInUserProfile`
- `clearRequiredPasswordChange`

### 4. Firebase Configuration and Security Rules

Configuration assets required to restore secure operation:

- `firebase.json`
- `firestore.rules`
- `firestore.indexes.json`
- frontend environment configuration values used by `js/firebase.js`

### 5. Frontend Application Source

Application source and deployment assets:

- `index.html`
- `style.css`
- `js/` source modules
- `package.json` and lockfiles

## Backup Strategy

### Firestore Backups

Recommended approach:

- Enable scheduled Firestore exports using Google Cloud scheduled exports or an equivalent automated export job.
- Store exports in a controlled backup bucket with restricted access.
- Retain daily backups for at least 30 days.
- Retain weekly or monthly backups for longer-term audit recovery, depending on business needs.

Recommended minimum frequency:

- Daily full backup
- Additional on-demand backup before major releases, data migrations, or bulk user/account changes

### Firebase Authentication Backups

Recommended approach:

- Export Firebase Auth users on a scheduled basis using the Firebase Admin SDK or Google Cloud Identity Toolkit export tooling.
- Keep Auth exports aligned with Firestore backup cadence so user records and profile records can be correlated during restoration.

Recommended minimum frequency:

- Daily export
- On-demand export before bulk staff onboarding or account maintenance exercises

### Source Code and Configuration Backups

Recommended approach:

- Use Git as the system of record for source code and Firebase configuration files.
- Push all production-relevant branches to a remote repository.
- Protect the default branch and require pull requests or review for sensitive changes.

Recommended minimum frequency:

- Continuous, with every approved change pushed to the remote repository

### Environment Configuration Backups

Recommended approach:

- Store production Firebase configuration values securely in a secrets manager or protected operational document.
- Keep a separate record of:
  - Firebase project ID
  - Hosting site/project mapping
  - deployed function region
  - required frontend environment variables

Important note:

- The repo contains a local `.env` file. It should not be treated as the only source of configuration recovery.

## Roles and Responsibilities

### Project Administrator

Responsible for:

- confirming backups are configured and running
- approving restore actions
- validating post-recovery access and user roles

### Technical Maintainer

Responsible for:

- maintaining backup scripts or scheduled jobs
- restoring Firestore, Auth, Functions, Hosting, and configuration
- validating application behavior after recovery

## Recovery Scenarios

### Scenario 1. Accidental Firestore Data Deletion or Corruption

Examples:

- deleted product records
- corrupted stock quantities
- missing sales history
- deleted user profile documents

Recovery steps:

1. Identify the affected collections and estimate the time of the incident.
2. Stop any non-essential admin updates to avoid further divergence.
3. Select the most appropriate Firestore backup prior to the incident.
4. Restore data into a staging or temporary environment first if possible.
5. Validate record counts and key relationships:
   - users to Auth accounts
   - products to stock receipts
   - sales against expected reporting totals
6. Restore to production using approved change control.
7. Verify that the application can read data correctly and that role-based access still works.

### Scenario 2. Loss of Firebase Authentication Users

Examples:

- staff accounts deleted
- sign-in failures caused by missing Auth records

Recovery steps:

1. Export the current Firestore `users` collection for comparison if still available.
2. Restore Firebase Auth users from the latest Auth backup.
3. Reconcile restored Auth accounts against Firestore `users` documents.
4. Confirm each active user has both:
   - a Firebase Auth account
   - a matching Firestore user profile
5. Test login for admin and non-admin roles.

### Scenario 3. Cloud Functions or Hosting Deployment Failure

Examples:

- broken release deployed
- callable functions unavailable
- frontend no longer loading

Recovery steps:

1. Retrieve the last known good version from Git.
2. Rebuild the frontend with the correct environment configuration.
3. Redeploy in this order:
   - Firestore rules if needed
   - Cloud Functions
   - Hosting
4. Validate:
   - app loads from Hosting
   - sign-in works
   - callable functions respond
   - Firestore reads and writes succeed for expected roles

### Scenario 4. Full Environment Rebuild

This applies if the Firebase project must be recreated or the application must be rebuilt in a new environment.

Recovery steps:

1. Create or prepare the target Firebase project.
2. Restore Firebase configuration values.
3. Deploy security rules and indexes.
4. Deploy Cloud Functions.
5. Restore Firestore data from backup.
6. Restore Firebase Auth users.
7. Build and deploy Hosting.
8. Perform smoke tests for:
   - login
   - dashboard access
   - product management
   - stock receiving
   - sales entry
   - supplier management
   - staff account creation

## Recovery Priorities

Recommended recovery order:

1. Restore secure platform configuration and access
2. Restore Firestore data
3. Restore Firebase Authentication
4. Restore Cloud Functions
5. Restore Hosting frontend
6. Validate critical business workflows

Reasoning:

- The app depends on both Firestore and Firebase Auth.
- User access is role-driven from Firestore `users` documents.
- Staff provisioning depends on Cloud Functions.
- The frontend is replaceable from source, but business data is the highest-value asset.

## Validation Checklist After Recovery

The following checks should be completed after any restore:

- the application loads successfully
- Firebase configuration is correct
- users can sign in
- admin users retain admin privileges
- non-admin roles remain correctly restricted
- product records are visible
- stock quantities are accurate
- sales history is available
- suppliers are available
- callable functions execute correctly
- Firestore security rules still enforce least privilege

## Recovery Time and Recovery Point Targets

Suggested targets for this project:

- Recovery Time Objective (RTO): 4 to 8 hours
- Recovery Point Objective (RPO): up to 24 hours, assuming daily backups

These values should be tightened if the application becomes more operationally critical.

## Current Gaps and Risks Observed

Based on the current repository state, the following gaps should be noted:

- No backup automation scripts are present in the repo.
- No documented Auth export process is currently included.
- No runbook for Firestore export/import is included.
- Production recovery appears dependent on local knowledge of Firebase configuration.
- A local `.env` file exists, which creates key-person and workstation risk if configuration is not stored elsewhere.
- The app uses local browser storage for some state, but browser local storage should not be treated as a reliable backup source.

## Recommendations

- Implement scheduled Firestore exports.
- Implement scheduled Firebase Auth exports.
- Store production configuration in a managed and access-controlled location.
- Add a tested restore runbook for Firestore and Auth.
- Perform at least one recovery drill in a non-production environment.
- Keep the remote Git repository current and protected.

## Conclusion

The most important recovery assets for this project are Firestore data, Firebase Authentication records, Firebase configuration, and the source-controlled application code. A practical backup strategy should prioritize automated Firestore and Auth exports, secure configuration management, and a documented restore process that can be executed without relying on a single developer workstation.
