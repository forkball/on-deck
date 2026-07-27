create table user_recommendations (
  id integer primary key autoincrement,
  user_id integer not null references users (id) on delete cascade,
  media_item_id integer not null references media_items (id) on delete cascade,
  reason text not null,
  rank integer not null,
  created_at integer not null
);
create index user_recommendations_user_idx on user_recommendations (user_id);
