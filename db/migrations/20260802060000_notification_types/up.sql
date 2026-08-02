-- Notifications were only ever about recommendation runs, so the table said
-- so: run_id was not null and pointed at recommendation_runs. Following
-- someone is the second thing worth telling a person about, and it has no run.
--
-- `type` names what happened; run_id becomes optional and is only set by the
-- kinds that have one. Existing rows are all recommendation runs, which is
-- what the default backfills them as.
alter table notifications add column type text not null default 'recommendation';
alter table notifications alter column run_id drop not null;

-- Following the same person twice should not notify them twice. Partial,
-- because recommendation notifications legitimately repeat between the same
-- pair of people.
create unique index notifications_follow_once
  on notifications (user_id, actor_user_id)
  where type = 'follow';
