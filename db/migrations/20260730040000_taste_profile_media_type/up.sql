alter table user_taste_profiles drop constraint user_taste_profiles_pkey;
alter table user_taste_profiles add column media_type text not null default 'movie';
alter table user_taste_profiles alter column media_type drop default;
alter table user_taste_profiles add primary key (user_id, media_type);
