# Go-live checklist

Nothing here has been done yet. Do it in this order, and stop at any step that does not behave as described.

## Before connecting anything
- [ ] Your tax preparer has confirmed: expense categories, the mileage method and rate, the set-aside percent, how tips are treated, and how expired inventory write-offs and year-end inventory are handled.
- [ ] You have the real Square export headers; `src/lib/squareFormat.ts` is updated and tested against a few made-up rows in that format. Sales-tax rows and partly refunded sales are decided.
- [ ] Two-factor authentication is on for GitHub, Vercel and Neon.

## Create the services (see SETUP.md for the clicks)
- [ ] New Neon project for this app only, Launch plan, restore window set to 7 days.
- [ ] GitHub OAuth app (new), with the callback `https://<your-url>/api/auth/callback/github`.
- [ ] New Vercel project from this repo. Environment variables set for **Production only**: `DATABASE_URL`, `GITHUB_ID`, `GITHUB_SECRET`, `NEXTAUTH_SECRET` (32+ random characters), `NEXTAUTH_URL` (https), `OWNER_GITHUB_ID` (your numeric ID). `ADMIN_DEV_BYPASS` must **not** exist.
- [ ] Deployment protection on the Vercel project stays on.

## First deploy (merging to `main` deploys)
- [ ] Open the site: you land on the sign-in page. The home page shows no "Server settings need attention" box after you sign in.
- [ ] Sign in with your GitHub account. Then try a second, different GitHub account (or a private window with another login): it must be refused. Activity shows "Signed in" and "Sign-in refused".
- [ ] Press **Set up database**. Schema version matches the app.
- [ ] Check the response headers on the sign-in page include `Content-Security-Policy` and `X-Frame-Options: DENY`.

## Before any real data
- [ ] Restore drill, both kinds (BACKUPS.md): a Neon console restore to a new branch, and `npm run backup` then `npm run restore-backup` into a new empty database, ending with "Every total and checksum matches".
- [ ] Enter the tax-year rules for the current year; mark each one confirmed only after your preparer confirms it.
- [ ] Import one small Square export. Compare the preview totals with Square's own report before pressing Import.

## Routine
- [ ] Monthly and before year-end: `npm run backup` to an encrypted disk, then `npm run verify-backup`.
- [ ] Glance at Activity now and then for anything you did not do.
- [ ] Review Dependabot pull requests when they appear; CI must be green before merging.
