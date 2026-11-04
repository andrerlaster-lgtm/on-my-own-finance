# Setup (one time, done by the owner)

Approved plan: Vercel Pro (about $20/month; Hobby is non-commercial only), Neon Launch plan with a 7-day restore window, two approved sign-ins only: GitHub for the administrator and Google for the business owner. Check current prices on the vendors' sites before subscribing.

1. **Neon**: create a new project (not shared with any other app). Choose the Launch plan. Set the restore window to 7 days (Settings → Storage / Restore window). Copy the pooled connection string.
2. **GitHub OAuth app** (GitHub → Settings → Developer settings → OAuth Apps → New):
   - Homepage URL: your Vercel URL. Callback URL: `https://<your-vercel-url>/api/auth/callback/github`.
   - Copy the Client ID and generate a Client secret.
   - Find your numeric GitHub ID: open `https://api.github.com/users/<your-username>` and copy `id`.
3. **Google OAuth client** (business owner's sign-in):
   - Google Cloud Console → create/select a project → APIs & Services → OAuth consent screen (External, add the business owner as a test user, or publish; scopes `openid`, `email`, `profile` only).
   - Credentials → Create credentials → OAuth client ID → Web application. Authorized JavaScript origin: `https://<your-vercel-url>`. Authorized redirect URI: `https://<your-vercel-url>/api/auth/callback/google` (add `http://localhost:5300/api/auth/callback/google` for local work).
   - Copy the Client ID and Client secret (into Vercel only) and decide the business owner's exact Google email address.
4. **Vercel**: import the `on-my-own-finance` repo (Pro plan). Add these environment variables (Production):
   - `DATABASE_URL` — Neon connection string
   - `GITHUB_ID`, `GITHUB_SECRET` — from step 2
   - `NEXTAUTH_SECRET` — a long random string (`openssl rand -base64 32`)
   - `NEXTAUTH_URL` — your Vercel URL
   - `OWNER_GITHUB_ID` — the administrator's numeric ID from step 2
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — from step 3
   - `BUSINESS_OWNER_GOOGLE_EMAIL` — the business owner's Google email (a verified address is required)
5. Deploy, sign in, press **Set up database** on the home page.
6. Do the restore drill in [BACKUPS.md](BACKUPS.md) **before** entering real data.

Never commit any of these values. `.env.example` lists names only.

## Who can do what

| | Administrator (GitHub) | Business owner (Google) |
|---|---|---|
| Income, expenses, inventory, mileage, taxes, accounting, reports, exports | yes | yes |
| Activity / security log | yes | no |
| Changing who may sign in (the Vercel variables above) | yes (Vercel access is the administrator's alone) | no |

Anyone else is refused at sign-in. Roles are worked out on the server on every request. To revoke the business owner, change or clear `BUSINESS_OWNER_GOOGLE_EMAIL` and redeploy: existing sessions stop working at once.
