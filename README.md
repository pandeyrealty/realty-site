# pandey.realty

Website for Pandey Realty, Inc. · Nayan Pandey, Broker & Mortgage Loan Officer.

Static site built by `build.mjs` (no dependencies) and hosted on Vercel. Every push to `main` rebuilds and deploys.

## Pages
- `/` homepage (`src/home.html`)
- `/active-listing/<slug>` one page per listing (`src/listing.html` template)
- `/mortgage` Mortgage Center (`src/mortgage.html`)
- `/calculators` 10 calculators (`src/calculators.html`)
- `/privacy`, `/terms` drafts, pending legal review
- `/api/lead` emails form submissions through Resend (`api/lead.js`)

Contact details, licenses, recent sales, reviews, and service areas live in `data/site.json`.

## Add a new listing
1. Create `listings/<slug>/` (e.g. `listings/123-main-st/`).
2. Put photos in `listings/<slug>/photos/` named `01.jpg`, `02.jpg`, … (about 1600px wide).
3. Copy `listings/1300-garvin/listing.json` into the folder and edit it:
   - `slug` must match the folder name
   - `status`: `active`, `pending`, `coming`, `sold`, or `draft` (draft is hidden)
   - `photos`: `[section, caption, photo number]`; sections become gallery filters
   - `hero`: `[photo number, caption]` for the slideshow
   - `units` is optional (for multi-unit properties); remove it for single-family homes
   - `video`: a YouTube/Vimeo/.mp4 link; set `"videoComingSoon": true` to show a placeholder
4. Push. The page appears at `pandey.realty/active-listing/<slug>` and on the homepage.

Sold listings move to `/sold-listing/<slug>` and show under "Recent sales".

## Environment variables (Vercel)
- `RESEND_API_KEY`: required for lead emails
- `LEAD_TO_EMAIL`: optional, comma-separated recipients (default pandeyrealty7@gmail.com)
- `LEAD_FROM_EMAIL`: optional verified sender, e.g. `Pandey Realty <leads@1300garvin.com>`

## Local preview
`node build.mjs` then serve `public/`.

## PDF brochures
Each listing's "Print brochure (PDF)" button opens `listings/<slug>/brochure.pdf`.
After adding a listing or changing its price, text, or photos, rebuild the brochure and commit it:

    pip install reportlab pillow   # once
    python3 tools/brochure.py <slug>     # or: python3 tools/brochure.py --all

Fonts (Inter, SIL Open Font License) are in `tools/fonts/`.

## Cinematic photo tour
`python3 tools/tour.py <slug>` makes `listings/<slug>/tour.mp4` + `tour.jpg` (16:9, ~1 min). The listing page shows it automatically (autoplays muted when scrolled into view, with a tab for the full YouTube walkthrough). Shots come from `"tour": {"shots": [[photo#, "caption", "motion"]]}` in listing.json (motions: in, out, left, right, up), or default to hero + unit photos. Uses original photos only. Add `--vertical` for a 9:16 Reels/TikTok version (move it to `src/assets/social/<slug>/`).

Tours get original, copyright-free background music automatically (`tools/music.py`, synthesized from scratch, a different key per listing, mixed to -16 LUFS); add `--silent` to skip it. On the page the tour autoplays muted; visitors tap "🔊 Tap for sound".

## CRM (pandey.realty/crm)

Private real estate + mortgage CRM. Not linked from the site and not indexed.

- Page: `src/crm.html` (built to `public/crm/index.html`). Server: `api/crm.js` + `lib/crm.js` (accounts, permissions, changes), `lib/crm-store.js` (storage), `lib/crm-config.js` (deal types, pipeline stages, loan programs, lists — edit here to change stages).
- Data: one private JSON file `crm/db.json` in the Vercel Blob store **pandey-crm** (saved with ETag checks so simultaneous saves never overwrite each other). A dated copy is saved daily to `crm/backups/YYYY-MM-DD.json`.
- Logins: broker username `nayan`. The broker adds agents/loan officers under **Team & logins**. Agents see only contacts assigned to them (as agent or loan officer); "lead pool" lets an agent take unassigned leads; "manager" lets them see and assign all contacts. Only the broker sees usernames and manages logins.
- Website forms (`api/lead.js`) also save each lead into the CRM (new or matched contact + deal + a call-back follow-up), unassigned unless it came from an agent's listing page whose CRM login has that agent's website profile set.
- Env vars: `BLOB_READ_WRITE_TOKEN` (from the store), `CRM_SECRET` (signs sessions; changing it signs everyone out), `CRM_BROKER_INIT_HASH` (starting broker password, used only when the database is first created).
- Local test: `CRM_LOCAL_DB=/tmp/crm.json` uses a local file instead of Blob (starting password `local-password-123`).
- Health check: `/api/crm?a=health` → `{"ok":true,"storage":"ready"}`.
- Morning email: `api/crm-digest.js`, run daily by Vercel Cron at 14:00 UTC (6 AM PST / 7 AM PDT; on the Hobby plan it can run any time in that hour). Each active login with an email and "Morning email" checked gets their follow-ups due today or overdue, new leads, closings in 7 days, and rate locks ending in 3 days. Nothing is sent to someone with nothing due. Protected by `CRON_SECRET`; sent through Resend with `LEAD_FROM_EMAIL`.
