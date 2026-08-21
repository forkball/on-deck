-- "I'm feeling lucky" produces an ordinary recommendation run — same queue,
-- same pipeline, same tables — carrying one pick instead of eight. This flag is
-- what tells the two apart afterwards.
--
-- It is deliberately a column on recommendation_runs rather than a separate
-- ledger table like recommendation_run_usage. That table exists because the cap
-- it enforces has to survive pruning, and a run row does not. A lucky run is the
-- opposite case: the thing being capped ("have you drawn today's pick yet?") and
-- the thing being displayed ("here is today's pick") are the same row, so
-- keeping the answer anywhere else would let the two disagree — a ledger saying
-- the day is spent while the landing page has nothing to show for it.
--
-- The row surviving its window is what makes that safe, and pruning is scoped to
-- match: app/data/recommendations/runs.ts prunes lucky and ordinary runs on
-- separate tracks, so three ordinary runs can never evict today's pick.
alter table recommendation_runs
  add column is_lucky boolean not null default false;

-- The only read is "this user's most recent lucky run since T". Partial, because
-- lucky runs are a thin slice of the table — one per person per day at most.
create index recommendation_runs_lucky_user_created
  on recommendation_runs (user_id, created_at desc)
  where is_lucky;
