drop table if exists user_recommendations;
create table user_recommendations (
  id integer primary key autoincrement,
  user_id integer not null references users (id) on delete cascade,
  media_item_id integer not null references media_items (id) on delete cascade,
  reason text not null,
  rank integer not null,
  group_label text,
  created_at integer not null
);

drop table if exists recommendation_run_members;
drop table if exists recommendation_runs;
