drop index if exists user_media_interactions_source_idx;
alter table user_media_interactions drop column source_entry_at;
alter table user_media_interactions drop column source;
