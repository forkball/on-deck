alter table user_taste_profiles drop constraint user_taste_profiles_pkey;
delete from user_taste_profiles where media_type != 'movie';
alter table user_taste_profiles drop column media_type;
alter table user_taste_profiles add primary key (user_id);
