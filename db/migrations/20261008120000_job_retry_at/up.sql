-- When a job put back in the queue may be claimed again.
--
-- A run that finds the catalog not answering is retried, and the retry resumes
-- from its checkpoint without asking the model again. But the retry went straight
-- back into the queue, and workers poll every two seconds, so all of a job's
-- attempts could be spent inside a few seconds of one outage — while Google
-- Books' circuit, which stays open for a minute, refused every one of them. The
-- attempts were meant to wait the outage out; this is what lets them.
--
-- Null for a job that may be claimed now, which is every job but a retry. Also
-- read by the generating page: a queued job with this set is a retry, and says so
-- instead of reading as a run that hasn't started.
alter table recommendation_jobs
  add column retry_at bigint;
