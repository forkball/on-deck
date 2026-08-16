-- One queued-or-running job per user, enforced by the database.
--
-- The rule already existed in code: the generate action called hasActiveJob and
-- refused if one was in flight. But that is a read followed by an unrelated
-- insert, with nothing between them. Two requests that arrive together both read
-- "no active job" and both enqueue, so double-clicking the generate button — or
-- replaying the POST — buys a second run.
--
-- That matters beyond the queue. The daily cap charges on save, not on enqueue,
-- so its correctness rests on at most one uncounted run existing at a time,
-- which is exactly what this rule is supposed to guarantee. Without it enforced,
-- concurrent requests pass the allowance check together and each spends several
-- model calls before any of them books a row.
--
-- Partial, so finished and failed rows are exempt and a user can start a new run
-- as soon as the last one leaves the queue.

-- Any pre-existing duplicates would fail the index creation below. The jobs
-- table is swept on a 10-minute TTL so this should find nothing, but a deploy
-- that aborts here would leave the release unshipped for the sake of rows that
-- are about to be deleted anyway. Keep the newest active job per user and
-- retire the rest.
update recommendation_jobs stale
   set status = 'failed',
       error = coalesce(stale.error, 'Superseded by a newer run.'),
       updated_at = (extract(epoch from now()) * 1000)::bigint
 where stale.status in ('queued', 'running')
   and exists (
     select 1
       from recommendation_jobs newer
      where newer.user_id = stale.user_id
        and newer.status in ('queued', 'running')
        and (newer.created_at, newer.id) > (stale.created_at, stale.id)
   );

create unique index recommendation_jobs_one_active_per_user
    on recommendation_jobs (user_id)
 where status in ('queued', 'running');
