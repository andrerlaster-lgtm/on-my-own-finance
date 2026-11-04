# If something looks wrong (lost phone, strange sign-in, unexpected change)

Do these in order. Each step is in a dashboard you control; nothing here needs the app to be working.

1. **Sign everyone out.** In Vercel → the project → Settings → Environment Variables, change `NEXTAUTH_SECRET` to a new long random value (`openssl rand -base64 32`) and redeploy. Every existing session stops working.
2. **Cut off the GitHub login.** In GitHub → Settings → Developer settings → OAuth Apps → this app, generate a new client secret and update `GITHUB_SECRET` in Vercel. If your GitHub account itself may be exposed, change its password, review its sessions and security log, and keep two-factor authentication on.
3. **Change the database password.** In the Neon console, reset the database role's password, then update `DATABASE_URL` in Vercel and redeploy.
4. **Look at what changed.** Open Activity in the app: it lists every change (adds, deletes, imports, exports, sign-ins allowed or refused) with times. Compare with what you did.
5. **Take a backup first, then repair.** Run `npm run backup` (see BACKUPS.md) so you have the current state, then use Neon's point-in-time restore to a moment before the problem (inside the 7-day window), or restore a backup into a new empty database.
6. **Receipts and exports are sensitive.** If a phone or computer holding a backup folder or a downloaded export was lost, treat the data in it as exposed: tell your tax preparer, and consider the steps above.

The app records only sign-in outcomes (allowed or refused) with a time, never account names.
