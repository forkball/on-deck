create table recommendation_runs (
  id integer primary key autoincrement,
  user_id integer not null references users (id) on delete cascade,
  created_at integer not null
);
create index recommendation_runs_user_idx on recommendation_runs (user_id);

create table recommendation_run_members (
  run_id integer not null references recommendation_runs (id) on delete cascade,
  user_id integer not null references users (id) on delete cascade,
  primary key (run_id, user_id)
);

drop table if exists user_recommendations;
create table user_recommendations (
  id integer primary key autoincrement,
  run_id integer not null references recommendation_runs (id) on delete cascade,
  media_item_id integer not null references media_items (id) on delete cascade,
  reason text not null,
  rank integer not null
);
create index user_recommendations_run_idx on user_recommendations (run_id);
