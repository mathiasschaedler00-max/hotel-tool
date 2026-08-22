-- ============================================================
-- Stage 5 (Fortsetzung): tasks — polymorph über related_type/related_id.
-- Eigene Migration entlang der Modulgrenze modules/housekeeping/tasks.
-- Fully idempotent.
-- ============================================================

create table if not exists tasks (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null references hotels(id) on delete cascade,
  -- Polymorph: z. B. related_type='room', related_id=rooms.id, oder
  -- related_type='reservation', related_id=reservations.id.
  -- Annahme — Teil A prüfen: kein DB-Constraint auf gültige related_type-Werte,
  -- da das je nach Modul erweiterbar bleiben soll.
  related_type      text not null,
  related_id        uuid not null,
  title             text not null,
  description       text,
  status            text not null default 'open' check (status in
    ('open','in_progress','done','cancelled')), -- Annahme — Teil A prüfen
  source            text not null default 'manual' check (source in ('manual','system','ai')),
  -- Brücke K5 ↔ Fachdaten: verknüpft eine KI-generierte Aufgabe mit ihrem
  -- Entscheidungs-Log-Eintrag (siehe modules/audit/service.ts#writeAiDecision).
  ai_decision_id    uuid references ai_decision_log(id),
  assigned_to       uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz,
  deleted_at        timestamptz
);
create index if not exists idx_tasks_hotel on tasks(hotel_id) where deleted_at is null;
create index if not exists idx_tasks_related on tasks(hotel_id, related_type, related_id) where deleted_at is null;
create index if not exists idx_tasks_status on tasks(hotel_id, status) where deleted_at is null;

create or replace trigger set_updated_at before update on tasks
  for each row execute function set_updated_at();

alter table tasks enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'tasks' and policyname = 'hotel members read/write'
  ) then
    create policy "hotel members read/write" on tasks for all using (is_hotel_member(hotel_id));
  end if;
end $$;
