# On My Own Finance — notes for AI helpers

Private business-finance app for a Texas sole-proprietor mobile blood-draw business. One user (the owner).

- Work on a branch, open a PR, one PR per phase. Do not merge, deploy, change env vars/keys, or touch the production database without the owner's approval. Deploys happen by merging to `main` (Vercel).
- **No patient or client data, ever.** No names, contact details, birth dates or health info in the schema, imports, logs or exports. Aggregate visit counts and non-identifying transaction info only. Do not import patient fields from Square.
- Keep revenue, processing fees, expenses and profit separate. Until expenses exist, never label revenue minus fees as profit ("Net after processing fees, before expenses").
- 1099-K (processor) and 1099-NEC (payer) totals are tracked separately. Tax rules are per year, start empty, and need "confirmed with preparer". Nothing here is tax advice.
- Every page, server action and API route must call `requireOwner()` / `ownerOrNull()` (tests enforce it).
- No secrets in the repo. Keep dependencies minimal and exact-pinned.
- Check: `npm run typecheck && npm test && npm run build`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
