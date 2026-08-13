drop table if exists profile_rebuild_usage;
alter table users drop column profile_use_notes;
alter table users drop column profile_log_limit;
