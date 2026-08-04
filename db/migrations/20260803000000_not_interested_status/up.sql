-- A fourth thing a log row can say. The other three are points on one line —
-- want it, partway through it, done with it — and none of them can express
-- "I've seen enough to know I don't want this", which is what the
-- recommendation pipeline needs to stop suggesting something.
--
-- The check constraint is the one from init_schema, declared inline on the
-- column and so auto-named by Postgres.
alter table user_media_interactions
  drop constraint if exists user_media_interactions_status_check;

alter table user_media_interactions
  add constraint user_media_interactions_status_check
  check (status in ('want_to_consume', 'in_progress', 'consumed', 'not_interested'));
