-- Dropped rather than rewritten: the narrower constraint can't go back while
-- rows violate it, and none of the three remaining statuses means "turned this
-- down" — mapping a rejection onto want_to_consume would invert it.
delete from user_media_interactions where status = 'not_interested';

alter table user_media_interactions
  drop constraint if exists user_media_interactions_status_check;

alter table user_media_interactions
  add constraint user_media_interactions_status_check
  check (status in ('want_to_consume', 'in_progress', 'consumed'));
