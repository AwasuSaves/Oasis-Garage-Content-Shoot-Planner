# OASIS GARAGE — Shoot Planner · Backend Setup

Your site is now a **member-driven app** backed by Supabase (Auth + Postgres + Realtime + Storage),
while staying a plain static site (no build step) deployed on Vercel. This guide is the checklist of
things **only you can do** in the Supabase and Vercel dashboards. Work top to bottom.

Project ref: `xxcsdejekscdkvubtvjz` · URL: `https://xxcsdejekscdkvubtvjz.supabase.co`
The site uses **only** the publishable (anon) key — never paste your secret key anywhere in the code.

---

## What changed in the code
- `index.html` — now loads `@supabase/supabase-js` from CDN, gates the whole app behind email
  sign-in, adds a first-run profile setup screen, and drives every section from the database.
  All original markup, styling, and design tokens are preserved.
- `supabase/schema.sql` — **run this once** to create every table, RLS policy, and seed row.
- `img/oasis-garage-logo.png` — a placeholder wordmark. **Replace it with your real logo export.**
- `support.js`, `oasis-map-3d.js`, `image-slot.js` — unchanged.

---

## STEP 1 — Create the database (2 min)
Supabase Dashboard → **SQL Editor** → **New query** → paste the entire contents of
`supabase/schema.sql` → **Run**. It is idempotent, so re-running it is safe.

This creates: `profiles`, `stops`, `availability`, `vision_cards`, `location_signups`,
`messages`, `images`; all Row-Level Security policies; the Storage access policies; Realtime;
and seed data (5 stops, 7 chat messages, 9 house vision cards).

## STEP 2 — Turn on email auth (1 min)
Dashboard → **Authentication → Sign In / Providers → Email** → make sure **Email** is **enabled**.

## STEP 3 — (Recommended) Speed up crew onboarding
Same Email settings page → toggle **Confirm email** **OFF** if you want members to sign up and land
straight in the app. If you leave it **ON** (default), each new member must click a confirmation link
in their inbox before they can sign in — the app handles this and shows "check your email".

## STEP 4 — Point auth at your live site (1 min)
Dashboard → **Authentication → URL Configuration** →
- **Site URL**: your production URL (e.g. `https://oasis-garage-planner.vercel.app`)
- **Redirect URLs**: add that same URL (and `http://localhost:*` if you test locally).

## STEP 5 — Create the photo Storage bucket (1 min)
Dashboard → **Storage → New bucket** → name it exactly **`shoot-photos`** → set it **Public** → Create.
(The access policies — signed-in members can view, only admins can upload/replace/delete — were
already installed by `schema.sql` in STEP 1.)

## STEP 6 — Add your real logo
Replace `img/oasis-garage-logo.png` with your actual Oasis Garage logo export (PNG or SVG saved as
that filename). The committed file is only an on-brand placeholder. Keep the filename the same and the
nav/auth/footer pick it up automatically.

## STEP 7 — Commit & deploy
```bash
git add -A
git commit -m "Supabase backend: auth, profiles, live sections, chat, admin map + photos"
git push
```
Vercel auto-deploys on push. If this is a first deploy: `npx vercel --prod`
(Framework preset **Other**, build command **none**, output directory **`.`**).

## STEP 8 — Make yourself the admin
Sign up on the live site with your email and finish the profile screen. Then, once, in the
Supabase **SQL Editor**, run (replace the email):
```sql
update public.profiles
set is_admin = true, in_crew = true
where id = (select id from auth.users where email = 'you@youremail.com');
```
Refresh the site — you'll now see the **ADMIN** nav item, the area-type control on the map, and the
Control Room (stop editor + photo manager). `is_admin` is protected by a database trigger, so members
cannot grant it to themselves.

---

## Verify each phase on the live site

**Phase 1 · Branding** — The nav, sign-in card, and footer all show your logo with the red underline.
After STEP 6 it's your real logo.

**Phase 2 · Auth + profiles** — Open the site in a private window → you're stopped at the sign-in
screen. Sign up → the profile setup screen collects name, sizes, car, location, avatar → submit lands
you in the app with your name + avatar in the nav. Reload → you stay signed in. Click **OUT** → back to
sign-in.

**Phase 3 · Live sections** —
- *Who's Rolling*: click **JOIN CREW** → your card appears with your car + wardrobe + avatar.
- *Who's Free When*: add a free window → your row appears in the grid; the red **FULL CREW** row lights
  the hours everyone overlaps.
- *The Vision*: **+ ADD VISION** → your card appears with a "BY YOU" tag and a delete ✕.
- *Boots on Ground*: click **I'LL BE AT THIS STOP** on a card → you're added to that stop's confirmed list.
Open the site as a second member (another browser/account) and watch crew, availability, vision, and
sign-ups update live.

**Phase 4 · Chat** — Type a message → it posts under your display name with your initials, and appears
in real time in the other browser.

**Phase 5 · Admin map** — As admin, click a map pin → the **AREA TYPE** dropdown appears and changes the
island type (persisted). As a non-admin member, the pin still selects/orbits/zooms but shows the area
type read-only. In **Control Room → Stops & Map Pins**, EDIT a stop or **+ ADD STOP** → it updates the
itinerary and map for everyone.

**Phase 6 · Photos** — In **Control Room → Photos**, choose a file for the Hero, any crew car, or any
vision card → it uploads to Storage and fills that slot for all members. **REMOVE** clears it. Members
cannot see these controls.

---

## Security notes (important)
- The anon key in `index.html` is public by design. **All** real protection lives in the RLS policies
  from `schema.sql`: members can read shared data and write only their own rows; admins additionally own
  stops, photos, and the Storage bucket.
- Never put a **secret** / service-role key in this site or any client code.
- If you ever rotate keys, update `window.OASIS_CFG.anon` in `index.html`.
