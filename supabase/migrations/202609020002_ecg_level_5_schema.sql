-- =============================================================================
-- ECG-LEVEL-5: research-grade annotation and dataset architecture
-- Additive migration. Existing Level 4 tables and application flows are kept.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Extend the canonical ECG record without changing existing Level 4 fields.
-- subject_key is the de-identified patient-level grouping key used for splits.
-- ---------------------------------------------------------------------------
alter table public.ecg_records
  add column if not exists study_uid uuid default gen_random_uuid(),
  add column if not exists subject_key text,
  add column if not exists acquisition_time timestamptz,
  add column if not exists lead_count integer,
  add column if not exists duration_ms integer,
  add column if not exists quality_status text,
  add column if not exists deidentified_at timestamptz;

update public.ecg_records
set subject_key = patient_id
where subject_key is null;

update public.ecg_records
set lead_count = case when source_type = 'waveform' then 12 else null end
where lead_count is null;

do $$ begin
  alter table public.ecg_records
    add constraint ecg_records_lead_count_check
    check (lead_count is null or lead_count between 1 and 32);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.ecg_records
    add constraint ecg_records_duration_ms_check
    check (duration_ms is null or duration_ms > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.ecg_records
    add constraint ecg_records_quality_status_check
    check (quality_status is null or quality_status in
      ('unreviewed', 'acceptable', 'limited', 'unusable'));
exception when duplicate_object then null; end $$;

create unique index if not exists ecg_records_study_uid_idx
  on public.ecg_records(study_uid);
create index if not exists ecg_records_subject_key_idx
  on public.ecg_records(dataset_id, subject_key);

create or replace function public.ensure_ecg_subject_key()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.subject_key is null or btrim(new.subject_key) = '' then
    new.subject_key = new.patient_id;
  end if;
  return new;
end; $$;

drop trigger if exists ensure_ecg_subject_key on public.ecg_records;
create trigger ensure_ecg_subject_key
  before insert or update on public.ecg_records
  for each row execute procedure public.ensure_ecg_subject_key();

-- ---------------------------------------------------------------------------
-- Dataset membership and assignments
-- ---------------------------------------------------------------------------
create table if not exists public.dataset_members (
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  member_role text not null default 'annotator'
    check (member_role in ('owner', 'manager', 'annotator', 'reviewer', 'adjudicator', 'viewer')),
  assigned_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (dataset_id, user_id)
);

insert into public.dataset_members (dataset_id, user_id, member_role, assigned_by)
select d.id, d.uploaded_by, 'owner', d.uploaded_by
from public.datasets d
where d.uploaded_by is not null
on conflict (dataset_id, user_id) do nothing;

create or replace function public.add_dataset_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.uploaded_by is not null then
    insert into public.dataset_members (dataset_id, user_id, member_role, assigned_by)
    values (new.id, new.uploaded_by, 'owner', new.uploaded_by)
    on conflict (dataset_id, user_id) do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists on_dataset_created_add_owner on public.datasets;
create trigger on_dataset_created_add_owner
  after insert on public.datasets
  for each row execute procedure public.add_dataset_owner();

create or replace function public.prevent_orphaned_dataset()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and old.member_role = 'owner' and not exists (
       select 1 from public.dataset_members dm
       where dm.dataset_id = old.dataset_id
         and dm.user_id <> old.user_id
         and dm.member_role = 'owner'
     ) then
    raise exception 'A dataset must retain at least one owner';
  end if;

  if tg_op = 'UPDATE'
     and old.member_role = 'owner'
     and (new.member_role <> 'owner' or new.dataset_id <> old.dataset_id or new.user_id <> old.user_id)
     and not exists (
       select 1 from public.dataset_members dm
       where dm.dataset_id = old.dataset_id
         and dm.user_id <> old.user_id
         and dm.member_role = 'owner'
     ) then
    raise exception 'A dataset must retain at least one owner';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

drop trigger if exists prevent_orphaned_dataset on public.dataset_members;
create trigger prevent_orphaned_dataset
  before delete or update on public.dataset_members
  for each row execute procedure public.prevent_orphaned_dataset();

create or replace function public.can_access_dataset(target_dataset uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists (
    select 1 from public.dataset_members dm
    where dm.dataset_id = target_dataset and dm.user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_dataset(target_dataset uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists (
    select 1 from public.dataset_members dm
    where dm.dataset_id = target_dataset
      and dm.user_id = auth.uid()
      and dm.member_role in ('owner', 'manager')
  );
$$;

create table if not exists public.annotation_assignments (
  id uuid primary key default gen_random_uuid(),
  ecg_record_id uuid not null references public.ecg_records(id) on delete cascade,
  assignee_id uuid not null references public.users(id) on delete cascade,
  assignment_role text not null default 'annotator'
    check (assignment_role in ('annotator', 'reviewer', 'adjudicator')),
  status text not null default 'assigned'
    check (status in ('assigned', 'in_progress', 'submitted', 'completed', 'cancelled')),
  due_at timestamptz,
  assigned_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ecg_record_id, assignee_id, assignment_role)
);

create index if not exists annotation_assignments_assignee_idx
  on public.annotation_assignments(assignee_id, status);

-- ---------------------------------------------------------------------------
-- Source provenance. Original objects are immutable; derivatives point back
-- to their parent source and carry a content hash.
-- ---------------------------------------------------------------------------
create table if not exists public.ecg_sources (
  id uuid primary key default gen_random_uuid(),
  ecg_record_id uuid not null references public.ecg_records(id) on delete cascade,
  parent_source_id uuid references public.ecg_sources(id) on delete set null,
  source_kind text not null check (source_kind in
    ('csv', 'wfdb', 'dicom', 'scp_ecg', 'xml', 'pdf', 'image', 'vendor_binary', 'derived')),
  storage_bucket text,
  storage_path text,
  original_filename text,
  media_type text,
  sha256 text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  device_manufacturer text,
  device_model text,
  acquisition_software text,
  sampling_rate_hz numeric check (sampling_rate_hz is null or sampling_rate_hz > 0),
  amplitude_unit text,
  gain jsonb not null default '{}'::jsonb,
  lead_names text[] not null default '{}'::text[],
  is_original boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  uploaded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (ecg_record_id, sha256)
);

create index if not exists ecg_sources_record_idx
  on public.ecg_sources(ecg_record_id);
create index if not exists ecg_sources_sha256_idx
  on public.ecg_sources(sha256) where sha256 is not null;

create or replace function public.validate_ecg_source_parent()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.parent_source_id is not null and not exists (
    select 1 from public.ecg_sources parent
    where parent.id = new.parent_source_id
      and parent.ecg_record_id = new.ecg_record_id
  ) then
    raise exception 'Parent source must belong to the same ECG record';
  end if;
  return new;
end; $$;

drop trigger if exists validate_ecg_source_parent on public.ecg_sources;
create trigger validate_ecg_source_parent
  before insert or update on public.ecg_sources
  for each row execute procedure public.validate_ecg_source_parent();

-- ---------------------------------------------------------------------------
-- Versioned annotation protocols and controlled vocabulary
-- ---------------------------------------------------------------------------
create table if not exists public.annotation_protocols (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text not null,
  description text,
  schema_definition jsonb not null default '{}'::jsonb,
  instructions_md text,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (name, version)
);

create table if not exists public.diagnosis_terms (
  id uuid primary key default gen_random_uuid(),
  code_system text not null default 'LABEL_ECG',
  code text not null,
  display_name text not null,
  category text not null check (category in
    ('rhythm', 'rate', 'axis', 'conduction', 'chamber', 'ischemia', 'infarction',
     'repolarization', 'interval', 'device', 'quality', 'other')),
  parent_id uuid references public.diagnosis_terms(id) on delete set null,
  synonyms text[] not null default '{}'::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (code_system, code)
);

-- ---------------------------------------------------------------------------
-- Annotation sessions. Every annotation belongs to an immutable submission
-- version; a submitted session is copied for later revisions rather than
-- overwritten.
-- ---------------------------------------------------------------------------
create table if not exists public.annotation_sessions (
  id uuid primary key default gen_random_uuid(),
  ecg_record_id uuid not null references public.ecg_records(id) on delete cascade,
  annotator_id uuid not null references public.users(id) on delete cascade,
  protocol_id uuid references public.annotation_protocols(id) on delete restrict,
  parent_session_id uuid references public.annotation_sessions(id) on delete set null,
  session_type text not null default 'primary'
    check (session_type in ('primary', 'secondary', 'review', 'adjudication', 'ai_preannotation')),
  round_number integer not null default 1 check (round_number > 0),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'in_review', 'accepted', 'rejected', 'superseded')),
  software_version text,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ecg_record_id, annotator_id, session_type, round_number)
);

create index if not exists annotation_sessions_record_idx
  on public.annotation_sessions(ecg_record_id, status);
create index if not exists annotation_sessions_annotator_idx
  on public.annotation_sessions(annotator_id, status);

create or replace function public.validate_annotation_session_lineage()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.parent_session_id is not null and not exists (
    select 1 from public.annotation_sessions parent
    where parent.id = new.parent_session_id
      and parent.ecg_record_id = new.ecg_record_id
  ) then
    raise exception 'Parent annotation session must belong to the same ECG record';
  end if;
  return new;
end; $$;

drop trigger if exists validate_annotation_session_lineage on public.annotation_sessions;
create trigger validate_annotation_session_lineage
  before insert or update
  on public.annotation_sessions
  for each row execute procedure public.validate_annotation_session_lineage();

create or replace function public.session_is_editable(target_session uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.annotation_sessions s
    where s.id = target_session
      and s.annotator_id = auth.uid()
      and s.status = 'draft'
      and s.locked_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- Sample-coordinate annotations. Positions are zero-based sample indexes.
-- ---------------------------------------------------------------------------
create table if not exists public.beat_annotations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.annotation_sessions(id) on delete cascade,
  sample_index bigint not null check (sample_index >= 0),
  lead_name text,
  beat_type text not null check (beat_type in
    ('normal', 'pac', 'pvc', 'paced', 'fusion', 'escape', 'junctional', 'artifact', 'unknown')),
  confidence numeric check (confidence is null or confidence between 0 and 1),
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, sample_index, lead_name)
);

create table if not exists public.wave_annotations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.annotation_sessions(id) on delete cascade,
  lead_name text not null,
  beat_sample bigint check (beat_sample is null or beat_sample >= 0),
  p_onset bigint,
  p_peak bigint,
  p_offset bigint,
  qrs_onset bigint,
  q_peak bigint,
  r_peak bigint,
  s_peak bigint,
  qrs_offset bigint,
  j_point bigint,
  t_onset bigint,
  t_peak bigint,
  t_offset bigint,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (p_onset is null or p_onset >= 0),
  check (p_peak is null or p_peak >= 0),
  check (p_offset is null or p_offset >= 0),
  check (qrs_onset is null or qrs_onset >= 0),
  check (q_peak is null or q_peak >= 0),
  check (r_peak is null or r_peak >= 0),
  check (s_peak is null or s_peak >= 0),
  check (qrs_offset is null or qrs_offset >= 0),
  check (j_point is null or j_point >= 0),
  check (t_onset is null or t_onset >= 0),
  check (t_peak is null or t_peak >= 0),
  check (t_offset is null or t_offset >= 0),
  check (p_onset is null or p_peak is null or p_onset <= p_peak),
  check (p_peak is null or p_offset is null or p_peak <= p_offset),
  check (qrs_onset is null or qrs_offset is null or qrs_onset <= qrs_offset),
  check (t_onset is null or t_peak is null or t_onset <= t_peak),
  check (t_peak is null or t_offset is null or t_peak <= t_offset)
);

create index if not exists wave_annotations_session_lead_idx
  on public.wave_annotations(session_id, lead_name);

create table if not exists public.rhythm_annotations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.annotation_sessions(id) on delete cascade,
  start_sample bigint not null check (start_sample >= 0),
  end_sample bigint not null check (end_sample > start_sample),
  rhythm_code text not null,
  lead_name text,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rhythm_annotations_session_range_idx
  on public.rhythm_annotations(session_id, start_sample, end_sample);

create table if not exists public.measurement_annotations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.annotation_sessions(id) on delete cascade,
  measurement_code text not null,
  value_numeric numeric not null,
  unit text not null,
  lead_name text,
  start_sample bigint check (start_sample is null or start_sample >= 0),
  end_sample bigint check (end_sample is null or end_sample >= 0),
  method text,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (start_sample is null or end_sample is null or end_sample >= start_sample)
);

create table if not exists public.diagnosis_annotations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.annotation_sessions(id) on delete cascade,
  diagnosis_term_id uuid references public.diagnosis_terms(id) on delete restrict,
  code_system text,
  diagnosis_code text,
  display_text text not null,
  is_present boolean not null default true,
  certainty text not null default 'definite'
    check (certainty in ('definite', 'probable', 'possible', 'excluded')),
  lead_names text[] not null default '{}'::text[],
  start_sample bigint check (start_sample is null or start_sample >= 0),
  end_sample bigint check (end_sample is null or end_sample >= 0),
  confidence numeric check (confidence is null or confidence between 0 and 1),
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (diagnosis_term_id is not null or diagnosis_code is not null),
  check (start_sample is null or end_sample is null or end_sample >= start_sample)
);

create index if not exists diagnosis_annotations_session_idx
  on public.diagnosis_annotations(session_id);
create index if not exists diagnosis_annotations_code_idx
  on public.diagnosis_annotations(code_system, diagnosis_code);

-- ---------------------------------------------------------------------------
-- Review, disagreement and adjudication
-- ---------------------------------------------------------------------------
create table if not exists public.adjudications (
  id uuid primary key default gen_random_uuid(),
  ecg_record_id uuid not null references public.ecg_records(id) on delete cascade,
  adjudicator_id uuid not null references public.users(id) on delete restrict,
  protocol_id uuid references public.annotation_protocols(id) on delete restrict,
  status text not null default 'open'
    check (status in ('open', 'resolved', 'reopened')),
  rationale text,
  final_session_id uuid references public.annotation_sessions(id) on delete set null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adjudication_inputs (
  adjudication_id uuid not null references public.adjudications(id) on delete cascade,
  session_id uuid not null references public.annotation_sessions(id) on delete cascade,
  primary key (adjudication_id, session_id)
);

create table if not exists public.adjudication_decisions (
  id uuid primary key default gen_random_uuid(),
  adjudication_id uuid not null references public.adjudications(id) on delete cascade,
  decision_type text not null check (decision_type in
    ('beat', 'wave', 'rhythm', 'measurement', 'diagnosis', 'quality', 'overall')),
  source_annotation_ids uuid[] not null default '{}'::uuid[],
  final_value jsonb not null,
  rationale text,
  created_at timestamptz not null default now()
);

create or replace function public.validate_adjudication_input()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1
    from public.adjudications a
    join public.annotation_sessions s on s.id = new.session_id
    where a.id = new.adjudication_id
      and a.ecg_record_id = s.ecg_record_id
  ) then
    raise exception 'Adjudication input session must belong to the adjudicated ECG record';
  end if;
  return new;
end; $$;

drop trigger if exists validate_adjudication_input on public.adjudication_inputs;
create trigger validate_adjudication_input
  before insert or update on public.adjudication_inputs
  for each row execute procedure public.validate_adjudication_input();

-- ---------------------------------------------------------------------------
-- Reproducible dataset releases and patient-level splits
-- ---------------------------------------------------------------------------
create table if not exists public.dataset_versions (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  version text not null,
  status text not null default 'draft'
    check (status in ('draft', 'frozen', 'published', 'retired')),
  protocol_id uuid references public.annotation_protocols(id) on delete restrict,
  description text,
  inclusion_criteria jsonb not null default '{}'::jsonb,
  exclusion_criteria jsonb not null default '{}'::jsonb,
  split_seed bigint,
  split_strategy text not null default 'patient_level'
    check (split_strategy in ('patient_level', 'site_level', 'temporal', 'external_only', 'none')),
  manifest_sha256 text,
  frozen_at timestamptz,
  published_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dataset_id, version)
);

create table if not exists public.dataset_version_records (
  dataset_version_id uuid not null references public.dataset_versions(id) on delete cascade,
  ecg_record_id uuid not null references public.ecg_records(id) on delete restrict,
  ground_truth_session_id uuid references public.annotation_sessions(id) on delete restrict,
  split text not null default 'unassigned'
    check (split in ('train', 'validation', 'test', 'external', 'unassigned')),
  subject_key text not null,
  included_at timestamptz not null default now(),
  primary key (dataset_version_id, ecg_record_id)
);

create or replace function public.enforce_dataset_version_lifecycle()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'retired' and new is distinct from old then
    raise exception 'A retired dataset version is immutable';
  end if;

  if old.status = 'draft' and new.status not in ('draft', 'frozen') then
    raise exception 'A draft dataset version must be frozen before publication';
  end if;

  if old.status = 'published' and new.status not in ('published', 'retired') then
    raise exception 'A published dataset version can only be retired';
  end if;

  if old.status = 'frozen' and new.status not in ('frozen', 'published', 'retired') then
    raise exception 'A frozen dataset version cannot return to draft';
  end if;

  if old.status <> 'draft' and (
    new.dataset_id is distinct from old.dataset_id or
    new.version is distinct from old.version or
    new.protocol_id is distinct from old.protocol_id or
    new.description is distinct from old.description or
    new.inclusion_criteria is distinct from old.inclusion_criteria or
    new.exclusion_criteria is distinct from old.exclusion_criteria or
    new.split_seed is distinct from old.split_seed or
    new.split_strategy is distinct from old.split_strategy or
    new.manifest_sha256 is distinct from old.manifest_sha256
  ) then
    raise exception 'Frozen dataset version metadata is immutable';
  end if;

  if old.status = 'draft' and new.status = 'frozen' then
    if new.manifest_sha256 is null then
      raise exception 'A manifest SHA-256 is required before freezing';
    end if;
    if exists (
      select 1 from public.dataset_version_records dvr
      where dvr.dataset_version_id = old.id
        and (dvr.split = 'unassigned' or dvr.ground_truth_session_id is null)
    ) then
      raise exception 'All records require a split and ground-truth session before freezing';
    end if;
    new.frozen_at = coalesce(new.frozen_at, now());
  end if;

  if new.status = 'published' and old.status <> 'published' then
    new.published_at = coalesce(new.published_at, now());
  end if;
  return new;
end; $$;

drop trigger if exists enforce_dataset_version_lifecycle on public.dataset_versions;
create trigger enforce_dataset_version_lifecycle
  before update on public.dataset_versions
  for each row execute procedure public.enforce_dataset_version_lifecycle();

create index if not exists dataset_version_records_split_idx
  on public.dataset_version_records(dataset_version_id, split);
create index if not exists dataset_version_records_subject_idx
  on public.dataset_version_records(dataset_version_id, subject_key);

create or replace function public.validate_dataset_version_record()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1
    from public.dataset_versions dv
    join public.ecg_records r on r.id = new.ecg_record_id
    where dv.id = new.dataset_version_id
      and dv.dataset_id = r.dataset_id
  ) then
    raise exception 'ECG record must belong to the dataset being versioned';
  end if;

  if new.ground_truth_session_id is not null and not exists (
    select 1 from public.annotation_sessions s
    where s.id = new.ground_truth_session_id
      and s.ecg_record_id = new.ecg_record_id
      and s.status in ('accepted', 'submitted')
  ) then
    raise exception 'Ground-truth session must be submitted or accepted and belong to the ECG record';
  end if;

  if new.subject_key is distinct from (
    select r.subject_key from public.ecg_records r where r.id = new.ecg_record_id
  ) then
    raise exception 'Version subject_key must match the ECG record subject_key';
  end if;
  return new;
end; $$;

drop trigger if exists validate_dataset_version_record on public.dataset_version_records;
create trigger validate_dataset_version_record
  before insert or update
  on public.dataset_version_records
  for each row execute procedure public.validate_dataset_version_record();

create or replace function public.enforce_patient_level_split()
returns trigger language plpgsql set search_path = public as $$
declare
  conflicting_split text;
begin
  select dvr.split into conflicting_split
  from public.dataset_version_records dvr
  where dvr.dataset_version_id = new.dataset_version_id
    and dvr.subject_key = new.subject_key
    and dvr.ecg_record_id <> new.ecg_record_id
    and dvr.split <> new.split
    and dvr.split <> 'unassigned'
    and new.split <> 'unassigned'
  limit 1;

  if conflicting_split is not null then
    raise exception 'Patient-level leakage: subject % is already assigned to %',
      new.subject_key, conflicting_split;
  end if;
  return new;
end; $$;

drop trigger if exists enforce_patient_split on public.dataset_version_records;
create trigger enforce_patient_split
  before insert or update
  on public.dataset_version_records
  for each row execute procedure public.enforce_patient_level_split();

create or replace function public.require_draft_dataset_version()
returns trigger language plpgsql set search_path = public as $$
declare target_version uuid;
begin
  target_version = case when tg_op = 'DELETE'
    then old.dataset_version_id else new.dataset_version_id end;
  if not exists (
    select 1 from public.dataset_versions dv
    where dv.id = target_version and dv.status = 'draft'
  ) then
    raise exception 'Records in a frozen or published dataset version are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

drop trigger if exists require_draft_dataset_version on public.dataset_version_records;
create trigger require_draft_dataset_version
  before insert or update or delete on public.dataset_version_records
  for each row execute procedure public.require_draft_dataset_version();

-- ---------------------------------------------------------------------------
-- Append-only research audit events
-- ---------------------------------------------------------------------------
create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.users(id) on delete set null,
  dataset_id uuid references public.datasets(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  event_type text not null,
  old_value jsonb,
  new_value jsonb,
  request_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_entity_idx
  on public.audit_events(entity_type, entity_id, created_at);
create index if not exists audit_events_dataset_idx
  on public.audit_events(dataset_id, created_at);

-- Controlled state transitions used by the client service layer.
create or replace function public.submit_annotation_session(session_uuid uuid)
returns public.annotation_sessions
language plpgsql set search_path = public as $$
declare result public.annotation_sessions;
begin
  update public.annotation_sessions
  set status = 'submitted', submitted_at = now(), locked_at = now(), updated_at = now()
  where id = session_uuid
    and annotator_id = auth.uid()
    and status = 'draft'
    and locked_at is null
  returning * into result;

  if result.id is null then
    raise exception 'Only the owner can submit an unlocked draft session';
  end if;
  return result;
end; $$;

create or replace function public.freeze_dataset_version(version_uuid uuid, manifest_hash text)
returns public.dataset_versions
language plpgsql security definer set search_path = public as $$
declare
  target_dataset uuid;
  result public.dataset_versions;
begin
  select dataset_id into target_dataset
  from public.dataset_versions where id = version_uuid;

  if target_dataset is null or not public.can_manage_dataset(target_dataset) then
    raise exception 'Dataset manager permission is required';
  end if;

  if exists (
    select 1 from public.dataset_version_records
    where dataset_version_id = version_uuid and split = 'unassigned'
  ) then
    raise exception 'All records must have a split before freezing';
  end if;

  if exists (
    select 1 from public.dataset_version_records
    where dataset_version_id = version_uuid and ground_truth_session_id is null
  ) then
    raise exception 'All records must have a ground-truth session before freezing';
  end if;

  update public.dataset_versions
  set status = 'frozen', manifest_sha256 = manifest_hash,
      frozen_at = now(), updated_at = now()
  where id = version_uuid and status = 'draft'
  returning * into result;

  if result.id is null then
    raise exception 'Only a draft dataset version can be frozen';
  end if;
  return result;
end; $$;

-- Keep updated_at consistent.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'annotation_assignments', 'annotation_sessions', 'beat_annotations',
    'wave_annotations', 'rhythm_annotations', 'adjudications', 'dataset_versions'
  ] loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', table_name, table_name);
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute procedure public.set_updated_at()',
      table_name, table_name
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: dataset-scoped access and draft-session ownership.
-- ---------------------------------------------------------------------------
alter table public.dataset_members enable row level security;
alter table public.annotation_assignments enable row level security;
alter table public.ecg_sources enable row level security;
alter table public.annotation_protocols enable row level security;
alter table public.diagnosis_terms enable row level security;
alter table public.annotation_sessions enable row level security;
alter table public.beat_annotations enable row level security;
alter table public.wave_annotations enable row level security;
alter table public.rhythm_annotations enable row level security;
alter table public.measurement_annotations enable row level security;
alter table public.diagnosis_annotations enable row level security;
alter table public.adjudications enable row level security;
alter table public.adjudication_inputs enable row level security;
alter table public.adjudication_decisions enable row level security;
alter table public.dataset_versions enable row level security;
alter table public.dataset_version_records enable row level security;
alter table public.audit_events enable row level security;

create policy "dataset members read membership" on public.dataset_members
  for select using (public.can_access_dataset(dataset_id));
create policy "dataset managers manage membership" on public.dataset_members
  for all using (public.can_manage_dataset(dataset_id))
  with check (public.can_manage_dataset(dataset_id));

create policy "members read assignments" on public.annotation_assignments
  for select using (
    assignee_id = auth.uid() or public.can_manage_dataset((select r.dataset_id from public.ecg_records r where r.id = ecg_record_id))
  );
create policy "managers create assignments" on public.annotation_assignments
  for insert with check (
    public.can_manage_dataset((select r.dataset_id from public.ecg_records r where r.id = ecg_record_id))
  );
create policy "assignees update assignments" on public.annotation_assignments
  for update using (
    assignee_id = auth.uid() or public.can_manage_dataset((select r.dataset_id from public.ecg_records r where r.id = ecg_record_id))
  );

create policy "members read ECG sources" on public.ecg_sources
  for select using (
    public.can_access_dataset((select r.dataset_id from public.ecg_records r where r.id = ecg_record_id))
  );
create policy "members create ECG sources" on public.ecg_sources
  for insert with check (
    uploaded_by = auth.uid() and
    public.can_access_dataset((select r.dataset_id from public.ecg_records r where r.id = ecg_record_id))
  );

create policy "authenticated read active protocols" on public.annotation_protocols
  for select using (auth.role() = 'authenticated');
create policy "admins manage protocols" on public.annotation_protocols
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "authenticated read diagnosis terms" on public.diagnosis_terms
  for select using (auth.role() = 'authenticated');
create policy "admins manage diagnosis terms" on public.diagnosis_terms
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "members read annotation sessions" on public.annotation_sessions
  for select using (
    public.can_access_dataset((select r.dataset_id from public.ecg_records r where r.id = ecg_record_id))
  );
create policy "annotators create own sessions" on public.annotation_sessions
  for insert with check (
    annotator_id = auth.uid() and
    public.can_access_dataset((select r.dataset_id from public.ecg_records r where r.id = ecg_record_id))
  );
create policy "annotators update own sessions" on public.annotation_sessions
  for update using (annotator_id = auth.uid() and status = 'draft')
  with check (annotator_id = auth.uid());

create policy "members read beat annotations" on public.beat_annotations
  for select using (exists (
    select 1 from public.annotation_sessions s join public.ecg_records r on r.id = s.ecg_record_id
    where s.id = session_id and public.can_access_dataset(r.dataset_id)
  ));
create policy "owners edit beat annotations" on public.beat_annotations
  for all using (public.session_is_editable(session_id))
  with check (public.session_is_editable(session_id));

create policy "members read wave annotations" on public.wave_annotations
  for select using (exists (
    select 1 from public.annotation_sessions s join public.ecg_records r on r.id = s.ecg_record_id
    where s.id = session_id and public.can_access_dataset(r.dataset_id)
  ));
create policy "owners edit wave annotations" on public.wave_annotations
  for all using (public.session_is_editable(session_id))
  with check (public.session_is_editable(session_id));

create policy "members read rhythm annotations" on public.rhythm_annotations
  for select using (exists (
    select 1 from public.annotation_sessions s join public.ecg_records r on r.id = s.ecg_record_id
    where s.id = session_id and public.can_access_dataset(r.dataset_id)
  ));
create policy "owners edit rhythm annotations" on public.rhythm_annotations
  for all using (public.session_is_editable(session_id))
  with check (public.session_is_editable(session_id));

create policy "members read measurements" on public.measurement_annotations
  for select using (exists (
    select 1 from public.annotation_sessions s join public.ecg_records r on r.id = s.ecg_record_id
    where s.id = session_id and public.can_access_dataset(r.dataset_id)
  ));
create policy "owners edit measurements" on public.measurement_annotations
  for all using (public.session_is_editable(session_id))
  with check (public.session_is_editable(session_id));

create policy "members read diagnoses" on public.diagnosis_annotations
  for select using (exists (
    select 1 from public.annotation_sessions s join public.ecg_records r on r.id = s.ecg_record_id
    where s.id = session_id and public.can_access_dataset(r.dataset_id)
  ));
create policy "owners edit diagnoses" on public.diagnosis_annotations
  for all using (public.session_is_editable(session_id))
  with check (public.session_is_editable(session_id));

create policy "members read adjudications" on public.adjudications
  for select using (
    public.can_access_dataset((select r.dataset_id from public.ecg_records r where r.id = ecg_record_id))
  );
create policy "adjudicators manage adjudications" on public.adjudications
  for all using (
    adjudicator_id = auth.uid() or
    public.can_manage_dataset((select r.dataset_id from public.ecg_records r where r.id = ecg_record_id))
  ) with check (
    adjudicator_id = auth.uid() and
    public.can_access_dataset((select r.dataset_id from public.ecg_records r where r.id = ecg_record_id))
  );

create policy "members read adjudication inputs" on public.adjudication_inputs
  for select using (exists (
    select 1 from public.adjudications a join public.ecg_records r on r.id = a.ecg_record_id
    where a.id = adjudication_id and public.can_access_dataset(r.dataset_id)
  ));
create policy "adjudicators manage inputs" on public.adjudication_inputs
  for all using (exists (
    select 1 from public.adjudications a
    where a.id = adjudication_id and (a.adjudicator_id = auth.uid() or public.is_platform_admin())
  )) with check (exists (
    select 1 from public.adjudications a
    where a.id = adjudication_id and (a.adjudicator_id = auth.uid() or public.is_platform_admin())
  ));

create policy "members read adjudication decisions" on public.adjudication_decisions
  for select using (exists (
    select 1 from public.adjudications a join public.ecg_records r on r.id = a.ecg_record_id
    where a.id = adjudication_id and public.can_access_dataset(r.dataset_id)
  ));
create policy "adjudicators create decisions" on public.adjudication_decisions
  for insert with check (exists (
    select 1 from public.adjudications a
    where a.id = adjudication_id and (a.adjudicator_id = auth.uid() or public.is_platform_admin())
  ));

create policy "members read dataset versions" on public.dataset_versions
  for select using (public.can_access_dataset(dataset_id));
create policy "managers manage dataset versions" on public.dataset_versions
  for all using (public.can_manage_dataset(dataset_id))
  with check (public.can_manage_dataset(dataset_id));

create policy "members read version records" on public.dataset_version_records
  for select using (exists (
    select 1 from public.dataset_versions dv
    where dv.id = dataset_version_id and public.can_access_dataset(dv.dataset_id)
  ));
create policy "managers manage version records" on public.dataset_version_records
  for all using (exists (
    select 1 from public.dataset_versions dv
    where dv.id = dataset_version_id and public.can_manage_dataset(dv.dataset_id)
  )) with check (exists (
    select 1 from public.dataset_versions dv
    where dv.id = dataset_version_id and public.can_manage_dataset(dv.dataset_id)
  ));

create policy "members read audit events" on public.audit_events
  for select using (dataset_id is not null and public.can_access_dataset(dataset_id));
create policy "authenticated append audit events" on public.audit_events
  for insert with check (
    actor_id = auth.uid() and dataset_id is not null and public.can_access_dataset(dataset_id)
  );

-- Function execution is restricted to signed-in users.
revoke all on function public.is_platform_admin() from public;
revoke all on function public.can_access_dataset(uuid) from public;
revoke all on function public.can_manage_dataset(uuid) from public;
revoke all on function public.session_is_editable(uuid) from public;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.can_access_dataset(uuid) to authenticated;
grant execute on function public.can_manage_dataset(uuid) to authenticated;
grant execute on function public.session_is_editable(uuid) to authenticated;
revoke all on function public.submit_annotation_session(uuid) from public;
revoke all on function public.freeze_dataset_version(uuid, text) from public;
grant execute on function public.submit_annotation_session(uuid) to authenticated;
grant execute on function public.freeze_dataset_version(uuid, text) to authenticated;

-- Seed a minimal, extensible diagnostic vocabulary.
insert into public.diagnosis_terms (code_system, code, display_name, category, synonyms)
values
  ('LABEL_ECG', 'NORMAL_ECG', 'Normal ECG', 'other', array['normal tracing']),
  ('LABEL_ECG', 'SINUS_RHYTHM', 'Sinus rhythm', 'rhythm', array['SR']),
  ('LABEL_ECG', 'ATRIAL_FIBRILLATION', 'Atrial fibrillation', 'rhythm', array['AF', 'AFIB']),
  ('LABEL_ECG', 'ATRIAL_FLUTTER', 'Atrial flutter', 'rhythm', array['AFL']),
  ('LABEL_ECG', 'PVC', 'Premature ventricular complex', 'rhythm', array['VPC']),
  ('LABEL_ECG', 'PAC', 'Premature atrial complex', 'rhythm', array['APC']),
  ('LABEL_ECG', 'RBBB', 'Right bundle branch block', 'conduction', array[]::text[]),
  ('LABEL_ECG', 'LBBB', 'Left bundle branch block', 'conduction', array[]::text[]),
  ('LABEL_ECG', 'ST_ELEVATION', 'ST-segment elevation', 'ischemia', array['STE']),
  ('LABEL_ECG', 'ST_DEPRESSION', 'ST-segment depression', 'ischemia', array['STD']),
  ('LABEL_ECG', 'LVH', 'Left ventricular hypertrophy', 'chamber', array[]::text[]),
  ('LABEL_ECG', 'LONG_QT', 'Prolonged QT interval', 'interval', array['QT prolongation'])
on conflict (code_system, code) do nothing;

insert into public.annotation_protocols (
  name, version, description, schema_definition, instructions_md, status
)
values (
  'LabelECG Core Annotation Protocol',
  '1.0.0',
  'Core beat, waveform, rhythm, measurement and diagnostic annotation contract.',
  jsonb_build_object(
    'coordinate_system', 'zero_based_sample_index',
    'required_reviewers', 2,
    'beat_types', jsonb_build_array('normal', 'pac', 'pvc', 'paced', 'fusion', 'escape', 'junctional', 'artifact', 'unknown'),
    'wave_landmarks', jsonb_build_array('p_onset', 'p_peak', 'p_offset', 'qrs_onset', 'q_peak', 'r_peak', 's_peak', 'qrs_offset', 'j_point', 't_onset', 't_peak', 't_offset'),
    'confidence_range', jsonb_build_array(0, 1)
  ),
  'Use the canonical waveform and zero-based sample coordinates. Mark uncertain findings with confidence and certainty; do not overwrite submitted sessions.',
  'draft'
)
on conflict (name, version) do nothing;
