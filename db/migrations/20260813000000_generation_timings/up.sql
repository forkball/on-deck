-- Records where a generation run's time actually went.
--
-- The pipeline fans out into model calls, catalog providers and the queue
-- itself, and nothing measured which of those a slow run waited on: the job
-- row tracked the phase it was in but never when that phase started. Every
-- claim about what to make faster was unfalsifiable, so this comes before any
-- of them.
--
-- Written to the job while it runs and copied onto the run afterwards. The job
-- row is swept ten minutes later; the run outlives it and carries the params
-- the numbers have to be read against, since a filtered group run and a plain
-- solo one have no reason to cost the same.
alter table recommendation_jobs add column timings text;
alter table recommendation_runs add column timings text;
