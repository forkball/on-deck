-- Turns recommendation_jobs from a progress record into a work queue.
--
-- Generation was fire-and-forget: the request started the work with no limit
-- on how much ran at once, and anything killed partway — a deploy, an OOM, a
-- machine stopping under scale-to-zero — lost every model and catalog call it
-- had already paid for.
--
-- `params` is what makes a job runnable by a machine that never received the
-- request. `checkpoint` is what makes a resumed one cheap: it records the
-- output of each finished stage, so picking a job back up skips work already
-- bought rather than repeating it.
alter table recommendation_jobs add column status text not null default 'running';
alter table recommendation_jobs add column params text not null default '{}';
alter table recommendation_jobs add column checkpoint text;
alter table recommendation_jobs add column claimed_at bigint;
alter table recommendation_jobs add column attempts integer not null default 0;

-- The claim query orders queued work by age; the sweep looks for running jobs
-- whose claim has gone stale.
create index recommendation_jobs_status_created on recommendation_jobs (status, created_at);
