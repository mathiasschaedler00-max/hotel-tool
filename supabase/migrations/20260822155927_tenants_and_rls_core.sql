-- ============================================================
-- Stage 1: Multi-Tenant-Kern (hotels, profiles, hotel_members)
-- + RLS-Helper is_hotel_member()/hotel_role()
-- Fully idempotent — safe to run multiple times.
-- ============================================================

-- Supabase-Standardprojekte haben pgcrypto i. d. R. schon aktiv — hier
-- trotzdem explizit + idempotent, falls dieses Projekt "from scratch" läuft.
create extension if not exists pgcrypto with schema extensions;

-- Gemeinsame Trigger-Funktion für `updated_at` (K6-Vorbereitung, siehe
-- ARCHITECTURE.md "Offline-/Sync-Architektur"). Wird von jeder veränderlichen
-- Fachtabelle ab der pms_core_domain-Migration per `before update`-Trigger genutzt.
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── hotels ───────────────────────────────────────────────────
create table if not exists hotels (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  region      text not null default 'AT',
  timezone    text not null default 'Europe/Vienna',
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ── profiles (1:1 zu auth.users) ────────────────────────────
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  created_at  timestamptz not null default now()
);

-- ── hotel_members (Mandanten-Zuordnung + RBAC-Rolle) ────────
-- Annahme — Teil A prüfen (K2): 7 Startrollen, muss mit
-- modules/rbac/permissions.ts PERMISSIONS-Keys übereinstimmen.
create table if not exists hotel_members (
  hotel_id    uuid not null references hotels(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in
    ('owner','general_manager','front_office','housekeeping_staff',
     'accounting','maintenance','readonly')),
  invited_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  primary key (hotel_id, user_id)
);

create index if not exists idx_hotel_members_user on hotel_members(user_id) where deleted_at is null;
create index if not exists idx_hotel_members_hotel on hotel_members(hotel_id) where deleted_at is null;

-- ── RLS-Helper (statt Inline-Subquery — vermeidet Rekursionsprobleme, ist planbar/cachebar) ──
create or replace function is_hotel_member(p_hotel_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from hotel_members
    where hotel_id = p_hotel_id and user_id = auth.uid() and deleted_at is null);
$$;

create or replace function hotel_role(p_hotel_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from hotel_members
  where hotel_id = p_hotel_id and user_id = auth.uid() and deleted_at is null limit 1;
$$;

-- ── RLS: hotels ──────────────────────────────────────────────
-- Kein globales SELECT auf hotels für alle Angemeldeten — nur Mitglieder
-- sehen "ihr" Hotel. `hotels.id` selbst ist noch keine fachliche Tabelle mit
-- `hotel_id`-Spalte, daher eigenes Policy-Muster (is_hotel_member(id) statt
-- is_hotel_member(hotel_id)).
alter table hotels enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'hotels' and policyname = 'hotel members read'
  ) then
    create policy "hotel members read" on hotels for select using (is_hotel_member(id));
  end if;
end $$;

-- ── RLS: profiles ────────────────────────────────────────────
-- Jeder darf sein eigenes Profil lesen/schreiben. Kein hotel_id-Bezug.
alter table profiles enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'profiles' and policyname = 'own profile'
  ) then
    create policy "own profile" on profiles for all using (id = auth.uid()) with check (id = auth.uid());
  end if;
end $$;

-- ── RLS: hotel_members ───────────────────────────────────────
-- Mitglieder eines Hotels dürfen die Mitgliederliste ihres eigenen Hotels
-- sehen. Schreibend (Rollen ändern, einladen) läuft ausschließlich über die
-- API-Schicht mit Service-Role (Vorgabe #2) — daher hier nur eine
-- SELECT-Policy, keine INSERT/UPDATE/DELETE-Policy für authenticated.
alter table hotel_members enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'hotel_members' and policyname = 'hotel members read roster'
  ) then
    create policy "hotel members read roster" on hotel_members for select using (is_hotel_member(hotel_id));
  end if;
end $$;
