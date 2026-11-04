# Backups and recovery

## What protects the data
- **Neon point-in-time restore.** Neon keeps continuous history, not daily snapshots. You can restore the database to any moment inside the restore window. Free plan: 6 hours (too short). Launch plan: configurable up to 7 days (this app's setting). Longer windows need a higher plan.
- **Your own export.** The home page downloads all data as JSON (and tax rules as CSV). Save a copy somewhere private (not in the repo) at least monthly and before year-end. Exports contain business data only, no patient information.

## Full backup you can restore from (run on your computer)
The web export is a convenience, not a full backup: it leaves out the receipt photos, and Vercel limits how large one web response can be (about 4.5 MB). The real backup is a command that reads the database directly and writes a folder you keep:

```
npm install
export DATABASE_URL="<your Neon connection string>"   # never put this in a file in the repo
npm run backup -- ~/finance-backups/2026-12-31        # a NEW folder; it refuses to overwrite
npm run verify-backup -- ~/finance-backups/2026-12-31 # checks every file and total, no database needed
```
- The folder holds every table (one JSON row per line), every receipt photo byte for byte, and a manifest with a checksum for each file plus row counts and money totals.
- It contains financial data and receipt photos. Keep it on an encrypted disk, never in the repository (`backups/` is ignored by git).
- Run it monthly, before year-end, and before any database change. Keep the year-end backup for as long as your preparer tells you to keep records.
- To prove a backup works, restore it into a **new empty** database (a new Neon branch or project, never the live one) and compare:
```
export DATABASE_URL="<connection string of the EMPTY database>"
npm run restore-backup -- ~/finance-backups/2026-12-31
```
It creates the tables, refuses to continue if any table already has rows, restores in dependency order, then re-reads the database and checks every row count, money total and receipt photo checksum against the backup. It prints "Every total and checksum matches" only if they do.
- Neon's point-in-time restore (below) is still the first tool for "undo a mistake from the last few days". The backup folder is for older history and for leaving Neon.

## Receipt photos
Receipt photos are stored in the database, so Neon's point-in-time restore covers them, and `npm run backup` saves every photo to the backup folder. The web JSON/CSV export lists them (id, size, date) but does **not** include the image bytes. Each photo is at most 1.5 MB (usually well under 1 MB), so storage grows slowly but is not free; check Neon's storage usage once real receipts are added.

## Restore drill (do once before real data, then yearly)
Do both parts: the Neon console restore below, and a file restore (`npm run restore-backup`) of a fresh backup into an empty database.
1. In the Neon console, open Backup & Restore (Restore) and create a branch from a point a few minutes ago.
2. Confirm the branch contains the `tax_year_rules` rows you expect.
3. Delete the test branch.
4. Write the date you did this here: ______

## If something goes wrong
1. Stop entering data.
2. Neon console → restore to a time just before the problem (inside the window).
3. Reload the app and compare against the latest JSON export.
4. If the window has passed, the JSON export is the fallback.
