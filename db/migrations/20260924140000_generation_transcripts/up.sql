-- What was asked of the model, what it answered, and what became of the answer.
--
-- All three were console output, which is the one place they couldn't be read:
-- the app's logs have not reached `fly logs` for the life of this app, so three
-- separate diagnoses this week have gone to the job row's timings instead — which
-- say how long each stage took and nothing about what it decided. The tally
-- (`picks 18 → kept 1 · unverified 11`) is the line that names where a run's picks
-- went, and it was being written to a stream nobody can read.
--
-- Kept per user rather than per run because the interesting cases are the runs
-- that never became one: an empty result, a catalog outage, a shortlist that
-- verification threw away. run_id is filled in when there is a run to point at.
create table generation_transcripts (
  id integer generated always as identity primary key,
  user_id integer not null references users (id) on delete cascade,
  -- Text, and not a foreign key: recommendation_jobs is swept ten minutes after a
  -- run finishes, and this outlives it on purpose.
  job_id text,
  run_id integer references recommendation_runs (id) on delete set null,
  media_type text not null,
  params text not null,
  prompt text not null,
  response text not null,
  -- The drop tally, written once the run is over. Null means it didn't get there.
  tally text,
  created_at bigint not null
);
create index generation_transcripts_user_idx on generation_transcripts (user_id, created_at desc);
