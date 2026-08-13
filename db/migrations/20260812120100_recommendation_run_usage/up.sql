-- One row per saved recommendation run, kept only long enough to answer "how
-- many has this person generated in the last 24 hours" — the ledger behind the
-- daily cap in app/data/recommendations/dailyLimit.ts.
--
-- Neither existing table can answer that question. recommendation_runs is
-- pruned to the newest MAX_RUNS_PER_USER per media type the moment the cap is
-- passed, so counting it hands back slots that were really spent; and
-- recommendation_jobs is swept ten minutes after a job stops moving, so by the
-- time it matters the evidence is gone. Both are right to do that — a cap needs
-- its own record rather than a byproduct of one kept for another purpose.
--
-- Rows outside the window are deleted on write, so this stays a rate-limit
-- ledger rather than a growing history of every run ever generated.
create table recommendation_run_usage (
  id integer generated always as identity primary key,
  user_id integer not null references users (id) on delete cascade,
  created_at bigint not null
);

-- The only read is "this user's rows since T".
create index recommendation_run_usage_user_created on recommendation_run_usage (user_id, created_at);
