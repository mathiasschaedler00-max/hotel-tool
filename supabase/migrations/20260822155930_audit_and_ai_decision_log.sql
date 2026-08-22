-- ============================================================
-- Stage 4: Audit-Log + KI-Entscheidungslog
-- Muss vor dem transaktionalen Write-Helper existieren (Stage 6).
-- Fully idempotent — safe to run multiple times.
-- ============================================================

create table if not exists audit_log (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references hotels(id) on delete cascade,
  actor_user_id   uuid references auth.users(id),
  actor_role      text,
  action          text not null,
  module          text not null,
  resource_type   text not null,
  resource_id     uuid not null,
  old_data        jsonb,
  new_data        jsonb,
  request_id      uuid,
  created_at      timestamptz not null default now()
);
create index if not exists idx_audit_log_hotel on audit_log(hotel_id, created_at desc);
create index if not exists idx_audit_log_resource on audit_log(hotel_id, resource_type, resource_id);

create table if not exists ai_decision_log (
  id                        uuid primary key default gen_random_uuid(),
  hotel_id                  uuid not null references hotels(id) on delete cascade,
  module                    text not null,
  decision_type             text not null,
  input_context             jsonb not null,
  model                     text not null,
  model_version             text,
  output                    jsonb not null,
  confidence                numeric(4,3),
  resulting_resource_type   text,
  resulting_resource_id     uuid,
  accepted                  boolean,
  accepted_by               uuid references auth.users(id),
  accepted_at               timestamptz,
  created_at                timestamptz not null default now()
);
create index if not exists idx_ai_decision_log_hotel on ai_decision_log(hotel_id, created_at desc);

-- ── RLS: beide Tabellen nur SELECT für Hotel-Mitglieder ─────
-- INSERT/UPDATE ausschließlich über Service-Role (Vorgabe #2) — der Browser
-- darf nie direkt schreiben, sonst wäre der Log manipulierbar. Deshalb bewusst
-- KEINE INSERT/UPDATE/DELETE-Policy für `authenticated`.
alter table audit_log enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'audit_log' and policyname = 'hotel members read audit log'
  ) then
    create policy "hotel members read audit log" on audit_log for select using (is_hotel_member(hotel_id));
  end if;
end $$;

alter table ai_decision_log enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'ai_decision_log' and policyname = 'hotel members read ai decision log'
  ) then
    create policy "hotel members read ai decision log" on ai_decision_log for select using (is_hotel_member(hotel_id));
  end if;
end $$;
