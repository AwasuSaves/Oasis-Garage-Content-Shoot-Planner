# Oasis Garage — Shoot-Day Call Sheet
**Handoff package for Claude Code. Everything you need is in this folder — read this file top to bottom before acting.**

---

## What this is
A finished, high-fidelity one-page concept website for a photoshoot-planning app
(brand: OASIS GARAGE — automotive, dark, Race Red accents). It is a
**self-contained static site**: plain HTML + JS, no bundler, no npm install,
no build step, no framework conversion needed. Deploy it as-is.

## Files
| File | Purpose |
|---|---|
| `index.html` | The entire app: sticky nav, hero, itinerary, interactive 3D map, moodboard, crew roster, availability grid, location checklists, group chat. |
| `support.js` | Page runtime that renders the `<x-dc>` template in index.html. **Never modify.** |
| `oasis-map-3d.js` | `<oasis-map-3d>` web component — interactive 3D route map (orbit/zoom, clickable pins, location "islands", animated car). three.js is loaded via the pinned import map already in `index.html`. |
| `image-slot.js` | `<image-slot>` drop-target component for photos. |

External runtime requests: Google Fonts + three.js\@0.184.0 from unpkg
(pinned with subresource integrity). Everything else is local. Works in any
WebGL-capable browser, responsive down to phones.

---

## TASK 1 — Deploy (do this first, ~2 min)
1. `git init && git add -A && git commit -m "Oasis Garage call sheet"`
2. Create a GitHub repo named `oasis-garage` (`gh repo create oasis-garage --public --source . --push`).
3. Deploy to Vercel: `npx vercel --prod`
   - Framework preset: **Other** · Build command: **none** · Output directory: **`.`** (root)
   - (Netlify / GitHub Pages / Cloudflare Pages work identically if Vercel fails.)
4. Report the live `*.vercel.app` URL.

**Do NOT** convert to React/Next, add a bundler, "clean up" the HTML, or
restyle anything. The design is final.

## TASK 2 — Wire the group chat to Supabase (optional, do after Task 1 is live)
The `#chat` section currently renders mock messages from the `msgs` array in
the `PLACEHOLDER SHOOT DATA` script block of `index.html`.

1. In the user's Supabase project, create table `messages`:
   `id uuid pk default gen_random_uuid(), name text, initials text, body text, created_at timestamptz default now()`
   with RLS enabled and policies allowing anonymous **select** and **insert**.
2. Seed it with the 7 existing mock messages from the `msgs` array (keep their names/timestamps flavor).
3. In `index.html`, load `@supabase/supabase-js` from CDN, fetch messages on
   load (ordered by `created_at`), and subscribe via Supabase Realtime so new
   messages appear live for all visitors.
4. On first send, prompt for a display name; persist it in `localStorage`
   (derive 2-letter initials from it).
5. **Keep the existing chat markup and styling exactly** — only swap the data
   source. Use the anon public key (safe for client use).
6. Everything else (availability, checklists, itinerary) stays static mock
   data. Do not add a backend for those.

## TASK 3 — Photos (whenever the user sends them)
The dashed placeholder tiles are `<image-slot>` elements in `index.html`:
- `id="hero-car"` — hero car shot (top of page)
- `id="mood-1"` … `id="mood-9"` — moodboard reference tiles
- `id="car-marcus|theo|dana|lena|jax|priya|rico|ava"` — crew car photos

To fill one: add the image file to the repo (e.g. `img/hero.jpg`) and set
`src="img/hero.jpg"` on the matching `<image-slot>`. Commit + redeploy.

---

## Editing the shoot plan (content)
All content is intentionally placeholder. It lives in ONE place: the script
block in `index.html` marked
`═══ PLACEHOLDER SHOOT DATA — EDIT EVERYTHING BELOW ═══`:
- `this.STOPS` — the 5 itinerary stops: name, address, arrive time, shoot
  window, description, map pin coords (`x,y`), and `s`/`e` (start/end in
  minutes since midnight — these drive the live "ON SET / UP NEXT / WRAPPED"
  states and the map car).
- `this.DEF_TYPES` — 3D island type per stop:
  `industrial | highway | harbor | city | mountain | farmland | parking | desert`
  (also switchable live via the AREA TYPE dropdown after clicking a map pin).
- `this.CREW` — 8 crew members: name, role, car, car details, wardrobe,
  availability ranges (hours, 24h).
- `this.MOOD` — 9 moodboard cards (type VIDEO/EDIT/PHOTO, title, description).
- `this.STOPCREW` — which crew indices are required at each stop (checklists).
- `this.CONFLICTS` — availability conflict callouts.
- `msgs` in `this.state` — the seed chat messages.

## Design tokens (already applied — reference only)
- Colors: Race Red `#E02020` (accent/CTA) · Midnight `#0F0F0F` and Carbon
  `#1A1A1A` (backgrounds) · Smoke `#3A3A3A` (borders) · Silver `#C8C8C8`,
  Ghost `#F5F5F5` (type)
- Type: Barlow Condensed italic 700–800 (display), Barlow 400–700 (body),
  JetBrains Mono (labels/times) — loaded from Google Fonts
- Tagline: "BUILD IT. OWN IT. DRIVE IT." · Sharp corners everywhere (no
  border-radius), 1px Smoke borders, red 3px underline on the wordmark

## Behavior notes
- Nav smooth-scrolls to sections and highlights the active one on scroll.
- Itinerary + map are time-aware off the visitor's clock (schedule
  06:30–21:00): current stop pulses "ON SET", next shows "UP NEXT".
- 3D map: drag = orbit, scroll = zoom, click a pin = select stop (car drives
  from Stop 1 to it; deselect = car loops the route). The strip under the map
  shows stop details + the AREA TYPE picker.
- Moodboard filters by VIDEO / EDIT / PHOTO.
- Checklist ticks and (until Task 2) chat sends are per-visitor only.
