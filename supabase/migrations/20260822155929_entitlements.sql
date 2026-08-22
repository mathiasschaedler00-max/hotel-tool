-- ============================================================
-- Stage 3: Entitlements / Modul-Schalter-System (modules, hotel_modules)
-- Annahme — Teil D prüfen: vollständiger Modul-Katalog noch nicht final.
-- Fully idempotent — safe to run multiple times.
-- ============================================================

create table if not exists modules (
  key         text primary key,
  name        text not null,
  description text
);

create table if not exists hotel_modules (
  hotel_id    uuid not null references hotels(id) on delete cascade,
  module_key  text not null references modules(key),
  enabled     boolean not null default false,
  enabled_at  timestamptz,
  enabled_by  uuid references auth.users(id),
  config      jsonb not null default '{}',
  primary key (hotel_id, module_key)
);

create index if not exists idx_hotel_modules_hotel on hotel_modules(hotel_id);

-- ── Startkatalog (Annahme — Teil D prüfen) ──────────────────
insert into modules (key, name, description) values
  ('pms', 'Property Management', 'Zimmer, Gäste, Reservierungen, Folios, Zahlungen'),
  ('housekeeping', 'Housekeeping', 'Reinigungs-/Wartungsaufgaben, Eskalationen'),
  ('notifications', 'Benachrichtigungen', 'Transaktionale E-Mails an Gäste/Mitarbeiter')
on conflict (key) do nothing;

-- ── RLS: modules (globaler Katalog, für alle Angemeldeten lesbar) ──
alter table modules enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'modules' and policyname = 'authenticated read catalog'
  ) then
    create policy "authenticated read catalog" on modules for select using (auth.uid() is not null);
  end if;
end $$;

-- ── RLS: hotel_modules ───────────────────────────────────────
-- Mitglieder dürfen sehen, welche Module für ihr Hotel aktiv sind (z. B. für
-- eine künftige Einstellungen-UI). Ein-/Ausschalten läuft ausschließlich über
-- die API-Schicht mit Service-Role (Vorgabe #2) — keine Schreib-Policy hier.
alter table hotel_modules enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'hotel_modules' and policyname = 'hotel members read entitlements'
  ) then
    create policy "hotel members read entitlements" on hotel_modules for select using (is_hotel_member(hotel_id));
  end if;
end $$;
