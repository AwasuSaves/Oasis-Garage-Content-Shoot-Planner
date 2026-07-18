-- ═══════════════════════════════════════════════════════════════════════════
-- OASIS GARAGE — Content Shoot Planner · Supabase schema + RLS + seed
-- Project ref: xxcsdejekscdkvubtvjz
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → New query → paste ALL of this
-- → Run.  It is idempotent (safe to re-run).  Nothing here needs your secret
-- key; the site only ever uses the publishable (anon) key.
--
-- Security model:
--   • Everything is behind Supabase Auth (email).  Only signed-in users read data.
--   • Members can write ONLY their own rows (profile, availability, vision cards,
--     location sign-ups, chat messages).
--   • Admins (profiles.is_admin = true) additionally own the stops/map, the
--     photo slots, and the Storage bucket.
--   • is_admin cannot be self-granted — a trigger blocks non-admins from
--     changing it.  You promote yourself once, by hand, in STEP 9 of SETUP.md.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Helper: am I an admin?  SECURITY DEFINER so it can read profiles without
-- ─── tripping that table's own RLS (prevents recursion in other policies).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. PROFILES  (one row per auth user)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  real_name     text,
  display_name  text,
  shirt_size    text,
  pants_size    text,
  car_make      text,
  car_model     text,
  car_year      int,
  car_details   text,
  location      text,
  avatar_icon   text default 'helmet',
  role          text default 'CREW',
  in_crew       boolean not null default false,
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Any signed-in member can read every profile (needed for the roster,
-- availability grid, checklists, chat names).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

-- You may create only your own profile row, keyed to your auth id.
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- You may update only your own profile row.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Block privilege escalation: a non-admin cannot flip their own is_admin.
create or replace function public.guard_admin_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_admin is distinct from old.is_admin and not public.is_admin() then
    new.is_admin := old.is_admin;   -- silently ignore the change
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_admin_flag on public.profiles;
create trigger trg_guard_admin_flag
  before update on public.profiles
  for each row execute function public.guard_admin_flag();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. STOPS  (itinerary + 3D map — admin-editable, everyone reads)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.stops (
  id          uuid primary key default gen_random_uuid(),
  sort_order  int  not null default 0,
  name        text not null,
  addr        text,
  arrive      text,          -- "06:30"
  win         text,          -- "07:00–08:00"
  what        text,          -- shot description shown on the itinerary + map
  s           int,           -- shoot start, minutes since midnight
  e           int,           -- shoot end,   minutes since midnight
  x           int,           -- map pin x
  y           int,           -- map pin y
  up          boolean default true,
  area_type   text default 'industrial'
              check (area_type in ('industrial','highway','harbor','city','mountain','farmland','parking','desert')),
  created_at  timestamptz not null default now()
);

alter table public.stops enable row level security;

drop policy if exists stops_select on public.stops;
create policy stops_select on public.stops
  for select to authenticated using (true);

drop policy if exists stops_admin_write on public.stops;
create policy stops_admin_write on public.stops
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. AVAILABILITY  (each member sets their own free windows, 24h hours)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.availability (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  start_hour  int  not null check (start_hour between 0 and 24),
  end_hour    int  not null check (end_hour between 0 and 24),
  created_at  timestamptz not null default now(),
  check (end_hour > start_hour)
);
create index if not exists availability_user_idx on public.availability(user_id);

alter table public.availability enable row level security;

drop policy if exists availability_select on public.availability;
create policy availability_select on public.availability
  for select to authenticated using (true);

drop policy if exists availability_own_write on public.availability;
create policy availability_own_write on public.availability
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. VISION CARDS  ("The Vision" moodboard — member-created)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.vision_cards (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references public.profiles(id) on delete set null,
  type        text not null default 'PHOTO' check (type in ('VIDEO','EDIT','PHOTO')),
  title       text not null,
  description text,
  source_link text,
  image_url   text,
  height      int  not null default 210,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.vision_cards enable row level security;

drop policy if exists vision_select on public.vision_cards;
create policy vision_select on public.vision_cards
  for select to authenticated using (true);

-- Create a card only as yourself.
drop policy if exists vision_insert on public.vision_cards;
create policy vision_insert on public.vision_cards
  for insert to authenticated with check (owner_id = auth.uid());

-- Edit/delete your own card, or any card if you are an admin.
drop policy if exists vision_update on public.vision_cards;
create policy vision_update on public.vision_cards
  for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists vision_delete on public.vision_cards;
create policy vision_delete on public.vision_cards
  for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. LOCATION SIGN-UPS  ("Boots on Ground" checklist — member picks stops)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.location_signups (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references public.profiles(id) on delete cascade,
  stop_id  uuid not null references public.stops(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, stop_id)
);
create index if not exists location_signups_stop_idx on public.location_signups(stop_id);

alter table public.location_signups enable row level security;

drop policy if exists signups_select on public.location_signups;
create policy signups_select on public.location_signups
  for select to authenticated using (true);

drop policy if exists signups_own_write on public.location_signups;
create policy signups_own_write on public.location_signups
  for all to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. MESSAGES  (group chat — realtime)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete set null,
  name       text not null,
  initials   text not null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_created_idx on public.messages(created_at);

alter table public.messages enable row level security;

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated using (true);

-- You can only post as yourself (or the row is a NULL-owner seed message).
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated with check (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. IMAGES  (photo slots — admin uploads; key = slot id in index.html)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.images (
  slot_id    text primary key,          -- 'hero-car', 'mood-1'…'mood-9', 'car-<name>'
  url        text not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.images enable row level security;

drop policy if exists images_select on public.images;
create policy images_select on public.images
  for select to authenticated using (true);

drop policy if exists images_admin_write on public.images;
create policy images_admin_write on public.images
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. STORAGE  (bucket for uploaded photos — admin write, signed-in read)
--    The bucket itself is created in the Dashboard (SETUP.md STEP 6); these
--    policies govern who can read/write objects inside it.
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "shoot photos readable" on storage.objects;
create policy "shoot photos readable" on storage.objects
  for select to authenticated using (bucket_id = 'shoot-photos');

drop policy if exists "shoot photos admin insert" on storage.objects;
create policy "shoot photos admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'shoot-photos' and public.is_admin());

drop policy if exists "shoot photos admin update" on storage.objects;
create policy "shoot photos admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'shoot-photos' and public.is_admin());

drop policy if exists "shoot photos admin delete" on storage.objects;
create policy "shoot photos admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'shoot-photos' and public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. REALTIME  (broadcast row changes to subscribed clients)
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  perform 1 from pg_publication where pubname = 'supabase_realtime';
  if found then
    -- add each table to the realtime publication if not already a member
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages')         then alter publication supabase_realtime add table public.messages; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='profiles')         then alter publication supabase_realtime add table public.profiles; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='availability')     then alter publication supabase_realtime add table public.availability; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='vision_cards')     then alter publication supabase_realtime add table public.vision_cards; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='location_signups') then alter publication supabase_realtime add table public.location_signups; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='stops')            then alter publication supabase_realtime add table public.stops; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='images')           then alter publication supabase_realtime add table public.images; end if;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. SEED DATA  (mirrors the original PLACEHOLDER SHOOT DATA in index.html)
--     Runs as the SQL owner, so RLS does not block these inserts.
--     Guarded so re-running does not duplicate.
-- ═══════════════════════════════════════════════════════════════════════════

-- 10a. Stops (the 5 itinerary/map stops + their default area types)
insert into public.stops (sort_order,name,addr,arrive,win,what,s,e,x,y,up,area_type)
select * from (values
  (0,'THE GARAGE HQ','Unit 7, Apex Industrial Park','06:30','07:00–08:00','Load-in · wipe-downs · crew brief · convoy rollout',390,480,120,400,true ,'industrial'),
  (1,'ROUTE 9 OVERPASS','Mile 14, State Route 9','09:00','09:15–11:00','Rolling shots · car-to-car · drone passes',540,660,330,215,true ,'highway'),
  (2,'HARBOR DOCKS','Pier 4, Eastside Marina','12:30','12:45–14:30','Static lineup · Looks 1–2 · detail macros',750,870,560,370,false,'harbor'),
  (3,'NEON ALLEY','Old Market District','15:30','15:45–17:30','Look 3 · night-grade plates · BTS video',930,1050,720,150,true ,'city'),
  (4,'SUMMIT LOOKOUT','Crestline Rd, Vista Point','18:30','19:00–21:00','Sunset heroes · group shot · wrap',1110,1260,875,305,false,'mountain')
) as v(sort_order,name,addr,arrive,win,what,s,e,x,y,up,area_type)
where not exists (select 1 from public.stops);

-- 10b. Seed chat messages (house/system posts — owner_id NULL)
insert into public.messages (name,initials,body,created_at)
select * from (values
  ('Ava Chen','AC','Call sheet is live. Read it twice. Call time 06:30 — coffee is on me.',   now() - interval '55 min'),
  ('Jax Morrow','JM','Supra aligned, tank full. She is ready to eat.',                        now() - interval '52 min'),
  ('Marcus Vale','MV','Golden hour at HQ is the money window. Do NOT be late.',               now() - interval '46 min'),
  ('Priya Nair','PN','Heads up — I land 08:30. Steaming looks 1–3 tonight, racks go in the van.', now() - interval '39 min'),
  ('Theo Okafor','TO','FX3 + gimbal charged. Rico, overpass drone corridor still clear?',     now() - interval '33 min'),
  ('Rico Santos','RS','Cleared it today. Two batteries per pass, wind looks calm. Hard out at 20:00 though.', now() - interval '26 min'),
  ('Lena Kowalski','LK','M2 washed. Nails painted Race Red. Obviously. See you at HQ.',        now() - interval '10 min')
) as v(name,initials,body,created_at)
where not exists (select 1 from public.messages);

-- 10c. Seed "house" vision cards so the board is not empty on day one
--      (owner_id NULL = brand card; members add their own alongside these).
insert into public.vision_cards (owner_id,type,title,description,height,sort_order)
select * from (values
  (null::uuid,'VIDEO','ROLLING SHOT — LOW 50MM','Car-to-car at 40 mph, lens skimming asphalt. This energy for Route 9.',200,1),
  (null::uuid,'PHOTO','DOCKSIDE LINEUP','Three-quarter front, staggered spacing, hard noon shadows.',255,2),
  (null::uuid,'EDIT','NIGHT GRADE — CRUSHED BLACKS','Blacks crushed, reds glowing, zero teal. Neon Alley reference.',180,3),
  (null::uuid,'VIDEO','WHIP-PAN TRANSITIONS','Location-to-location whips for the recap edit.',215,4),
  (null::uuid,'PHOTO','DETAIL MACRO SET','Badges, brake dust, exhaust tips. Shallow depth.',235,5),
  (null::uuid,'EDIT','SPEED-RAMP SEQUENCE','120 fps → 24 fps on the overpass pass-bys.',195,6),
  (null::uuid,'PHOTO','GOLDEN HOUR HEROES','Backlit silhouettes at Summit. Low angle, wide.',275,7),
  (null::uuid,'VIDEO','BTS HANDYCAM','Grainy 4:3 handycam for socials. Chaos welcome.',190,8),
  (null::uuid,'EDIT','POSTER FRAME','One frame per car for the drop poster. Centered, symmetric.',225,9)
) as v(owner_id,type,title,description,height,sort_order)
where not exists (select 1 from public.vision_cards);

-- ═══════════════════════════════════════════════════════════════════════════
-- DONE.  Next: SETUP.md STEP 5 (enable email auth), STEP 6 (create the
-- 'shoot-photos' Storage bucket), then sign up and STEP 9 (promote yourself
-- to admin).
-- ═══════════════════════════════════════════════════════════════════════════
