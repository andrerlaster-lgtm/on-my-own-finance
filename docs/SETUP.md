# Setup (one time, done by the owner)

Approved plan: Vercel Pro (about $20/month; Hobby is non-commercial only), Neon Launch plan with a 7-day restore window, GitHub sign-in for the owner only. Check current prices on the vendors' sites before subscribing.

1. **Neon**: create a new project (not shared with any other app). Choose the Launch plan. Set the restore window to 7 days (Settings → Storage / Restore window). Copy the pooled connection string.
2. **GitHub OAuth app** (GitHub → Settings → Developer settings → OAuth Apps → New):
   - Homepage URL: your Vercel URL. Callback URL: `https://<your-vercel-url>/api/auth/callback/github`.
   - Copy the Client ID and generate a Client secret.
   - Find your numeric GitHub ID: open `https://api.github.com/users/<your-username>` and copy `id`.
3. **Vercel**: import the `on-my-own-finance` repo (Pro plan). Add these environment variables (Production):
   - `DATABASE_URL` — Neon connection string
   - `GITHUB_ID`, `GITHUB_SECRET` — from step 2
   - `NEXTAUTH_SECRET` — a long random string (`openssl rand -base64 32`)
   - `NEXTAUTH_URL` — your Vercel URL
   - `OWNER_GITHUB_ID` — the numeric ID from step 2
4. Deploy, sign in, press **Set up database** on the home page.
5. Do the restore drill in [BACKUPS.md](BACKUPS.md) **before** entering real data.

Never commit any of these values. `.env.example` lists names only.
