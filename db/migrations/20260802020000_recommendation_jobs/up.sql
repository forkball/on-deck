-- Live progress for an in-flight recommendation run.
--
-- This started in process memory, on the assumption the app ran as a single
-- machine. It doesn't: a single [[vm]] block in fly.toml sets the machine
-- size, not the count, and there are two. The POST that starts a run lands on
-- one machine and writes the job into its heap; the poll that follows can be
-- routed to the other, which has never heard of it and answers 404.
--
-- Shared state is the only thing both machines can read, so it lives here.
create table recommendation_jobs (
  id text primary key,
  user_id integer not null references users (id) on delete cascade,
  -- The stages this run will pass through, comma separated. Not every run
  -- hits every stage, so the list is fixed when the job starts.
  phases text not null,
  phase text not null,
  -- Set once the run finishes; the wait page redirects here.
  run_id integer references recommendation_runs (id) on delete set null,
  pruned_oldest_run integer not null default 0,
  error text,
  created_at bigint not null,
  updated_at bigint not null
);

-- Only ever read by id for a given user, and swept by age.
create index recommendation_jobs_updated_at on recommendation_jobs (updated_at);
