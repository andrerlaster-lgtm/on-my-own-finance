# On My Own Finance

Private business-finance tracker (visits, revenue, fees, expenses, profit, mileage, inventory, year-end export for the tax preparer). One user, GitHub sign-in restricted to the owner's account. Not tax filing software.

**Status: Phase 1 in progress.** Phase 0: sign-in, database setup, per-year tax rules, JSON/CSV export, backup plan. Phase 1 so far: manual income entry, inventory ledger, dashboard (week/month/year). The Square CSV import is waiting for the real export headers.

- Setup steps: [docs/SETUP.md](docs/SETUP.md)
- Backups and restore: [docs/BACKUPS.md](docs/BACKUPS.md)
- How numbers are counted: [docs/ACCOUNTING.md](docs/ACCOUNTING.md)
- Privacy: the database has no place for patient/client names, contact details or health information.

```
npm install
cp .env.example .env.local   # fill in; see docs/SETUP.md
npm run dev                  # http://localhost:5300
npm run typecheck && npm test && npm run build
```

Local-only testing without GitHub: set `ADMIN_DEV_BYPASS=1` in `.env.local`. It is ignored in production builds.
