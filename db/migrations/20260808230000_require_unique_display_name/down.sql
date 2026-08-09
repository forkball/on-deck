alter table users drop constraint users_display_name_key;
alter table users alter column display_name drop not null;
