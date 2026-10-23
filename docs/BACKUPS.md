# Backups and recovery

## What protects the data
- **Neon point-in-time restore.** Neon keeps continuous history, not daily snapshots. You can restore the database to any moment inside the restore window. Free plan: 6 hours (too short). Launch plan: configurable up to 7 days (this app's setting). Longer windows need a higher plan.
- **Your own export.** The home page downloads all data as JSON (and tax rules as CSV). Save a copy somewhere private (not in the repo) at least monthly and before year-end. Exports contain business data only, no patient information.

## Restore drill (do once before real data, then yearly)
1. In the Neon console, open Backup & Restore (Restore) and create a branch from a point a few minutes ago.
2. Confirm the branch contains the `tax_year_rules` rows you expect.
3. Delete the test branch.
4. Write the date you did this here: ______

## If something goes wrong
1. Stop entering data.
2. Neon console → restore to a time just before the problem (inside the window).
3. Reload the app and compare against the latest JSON export.
4. If the window has passed, the JSON export is the fallback.
