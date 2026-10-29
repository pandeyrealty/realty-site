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
