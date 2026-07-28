-- Backs logInteraction's atomic upsert (ON CONFLICT (user_id, media_item_id))
-- — without this, concurrent writers (e.g. the Letterboxd import's worker
-- pool) can race a plain find-then-write into two rows for the same movie.
alter table user_media_interactions
  add constraint user_media_interactions_user_media_uniq unique (user_id, media_item_id);
