-- =============================================================================
-- LabelECG database schema
-- Run this once in your Supabase project's SQL Editor (or via `supabase db push`
-- if you use the Supabase CLI) before using the app.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- users: one row per app user, keyed to Supabase auth.users
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  email text not null,
  role text not null default 'annotator' check (role in ('annotator', 'expert', 'admin')),
  hospital_name text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- datasets: a named collection of ECG records uploaded by one user
-- ---------------------------------------------------------------------------
create table if not exists public.datasets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  uploaded_by uuid references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ecg_records: metadata for one ECG (no waveform data — see ecg_raw_data)
-- ---------------------------------------------------------------------------
create table if not exists public.ecg_records (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  patient_id text not null,
  record_number integer,
  "timestamp" timestamptz not null default now(),
  heart_rate integer,
  pr_interval integer,
  qrs_duration integer,
  qt_interval integer,
  auto_analysis text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ecg_records_dataset_id_idx on public.ecg_records(dataset_id);

-- ---------------------------------------------------------------------------
-- ecg_raw_data: the real 12-lead sample arrays for one record
-- ---------------------------------------------------------------------------
create table if not exists public.ecg_raw_data (
  id uuid primary key default gen_random_uuid(),
  ecg_record_id uuid not null unique references public.ecg_records(id) on delete cascade,
  lead_i double precision[] not null,
  lead_ii double precision[] not null,
  lead_iii double precision[] not null,
  lead_avr double precision[] not null,
  lead_avl double precision[] not null,
  lead_avf double precision[] not null,
  lead_v1 double precision[] not null,
  lead_v2 double precision[] not null,
  lead_v3 double precision[] not null,
  lead_v4 double precision[] not null,
  lead_v5 double precision[] not null,
  lead_v6 double precision[] not null,
  sampling_rate integer not null default 500,
  duration double precision
);

-- ---------------------------------------------------------------------------
-- annotations: one annotator's diagnosis/findings for one record
-- ---------------------------------------------------------------------------
create table if not exists public.annotations (
  id uuid primary key default gen_random_uuid(),
  ecg_record_id uuid not null references public.ecg_records(id) on delete cascade,
  annotator_id uuid not null references public.users(id) on delete cascade,
  diagnosis text,
  status text not null default 'unsure' check (status in ('confirmed', 'unsure', 'reviewed')),
  findings text,
  confidence_score numeric,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ecg_record_id, annotator_id)
);

create index if not exists annotations_ecg_record_id_idx on public.annotations(ecg_record_id);
create index if not exists annotations_annotator_id_idx on public.annotations(annotator_id);

-- ---------------------------------------------------------------------------
-- annotation_history: audit trail of annotation create/update/review events
-- ---------------------------------------------------------------------------
create table if not exists public.annotation_history (
  id uuid primary key default gen_random_uuid(),
  annotation_id uuid not null references public.annotations(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  action text not null,
  old_diagnosis text,
  new_diagnosis text,
  old_status text,
  new_status text,
  created_at timestamptz not null default now()
);

-- =============================================================================
-- Row-level security
-- These policies are intentionally simple (any signed-in user can read/write
-- most things) to get a real deployment working end to end. Tighten them to
-- your institution's requirements — e.g. restricting review actions to the
-- 'expert'/'admin' roles, or scoping datasets to a hospital — before handling
-- real patient data in production.
-- =============================================================================

alter table public.users enable row level security;
alter table public.datasets enable row level security;
alter table public.ecg_records enable row level security;
alter table public.ecg_raw_data enable row level security;
alter table public.annotations enable row level security;
alter table public.annotation_history enable row level security;

create policy "users can read all profiles" on public.users
  for select using (auth.role() = 'authenticated');
create policy "users can insert their own profile" on public.users
  for insert with check (auth.uid() = id);
create policy "users can update their own profile" on public.users
  for update using (auth.uid() = id);

create policy "authenticated read datasets" on public.datasets
  for select using (auth.role() = 'authenticated');
create policy "authenticated create datasets" on public.datasets
  for insert with check (auth.role() = 'authenticated');

create policy "authenticated read ecg_records" on public.ecg_records
  for select using (auth.role() = 'authenticated');
create policy "authenticated create ecg_records" on public.ecg_records
  for insert with check (auth.role() = 'authenticated');
create policy "authenticated delete own ecg_records" on public.ecg_records
  for delete using (
    auth.role() = 'authenticated' and
    exists (
      select 1 from public.datasets d
      where d.id = dataset_id and d.uploaded_by = auth.uid()
    )
  );

create policy "authenticated read ecg_raw_data" on public.ecg_raw_data
  for select using (auth.role() = 'authenticated');
create policy "authenticated create ecg_raw_data" on public.ecg_raw_data
  for insert with check (auth.role() = 'authenticated');

create policy "authenticated read annotations" on public.annotations
  for select using (auth.role() = 'authenticated');
create policy "users manage their own annotations" on public.annotations
  for insert with check (auth.uid() = annotator_id);
create policy "users update their own annotations" on public.annotations
  for update using (auth.uid() = annotator_id);
create policy "experts admins update annotations" on public.annotations
  for update using (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role in ('expert', 'admin')
    )
  );

create policy "authenticated read annotation_history" on public.annotation_history
  for select using (auth.role() = 'authenticated');
create policy "authenticated write annotation_history" on public.annotation_history
  for insert with check (auth.role() = 'authenticated');

-- =============================================================================
-- SQL functions used by the app (src/lib/supabase.js)
-- =============================================================================

-- Total vs annotated record counts for one dataset
create or replace function public.get_dataset_progress(dataset_uuid uuid)
returns table (total_records bigint, annotated_records bigint, coverage numeric)
language sql
stable
as $$
  select
    count(distinct r.id) as total_records,
    count(distinct a.ecg_record_id) as annotated_records,
    case when count(distinct r.id) = 0 then 0
      else round(count(distinct a.ecg_record_id)::numeric / count(distinct r.id) * 100, 1)
    end as coverage
  from public.ecg_records r
  left join public.annotations a on a.ecg_record_id = r.id
  where r.dataset_id = dataset_uuid;
$$;

-- Per-annotator record counts for one dataset (used by the Review screen)
create or replace function public.get_dataset_annotator_summary(dataset_uuid uuid)
returns table (annotator_id uuid, username text, annotated_count bigint)
language sql
stable
as $$
  select u.id as annotator_id, u.username, count(a.id) as annotated_count
  from public.annotations a
  join public.ecg_records r on r.id = a.ecg_record_id
  join public.users u on u.id = a.annotator_id
  where r.dataset_id = dataset_uuid
  group by u.id, u.username
  order by annotated_count desc;
$$;

-- Aggregate annotation stats for one user (used on the Account screen)
create or replace function public.get_user_annotation_stats(user_id uuid)
returns table (
  total_annotations bigint,
  confirmed_count bigint,
  unsure_count bigint,
  datasets_worked_on bigint
)
language sql
stable
as $$
  select
    count(a.id) as total_annotations,
    count(a.id) filter (where a.status = 'confirmed') as confirmed_count,
    count(a.id) filter (where a.status = 'unsure') as unsure_count,
    count(distinct r.dataset_id) as datasets_worked_on
  from public.annotations a
  join public.ecg_records r on r.id = a.ecg_record_id
  where a.annotator_id = user_id;
$$;
