-- display_name now doubles as a login handle, so it has to be both present
-- and unique. Safe to apply directly (no backfill): every existing row
-- already has a non-null, distinct display_name.
alter table users alter column display_name set not null;
alter table users add constraint users_display_name_key unique (display_name);
