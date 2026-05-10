alter table public.papers
  add column if not exists landing_field text,
  add column if not exists landing_theme text,
  add column if not exists landing_concept text,
  add column if not exists landing_classification_confidence jsonb default '{}'::jsonb;

create index if not exists idx_papers_landing_map
  on public.papers (status, landing_field, landing_theme, landing_concept);
