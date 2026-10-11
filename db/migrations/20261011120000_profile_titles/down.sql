delete from notifications where type = 'title';
alter table notifications drop column if exists unlocked_titles;
alter table users drop column if exists title_noun;
alter table users drop column if exists title_adjective;
drop table if exists user_titles;
