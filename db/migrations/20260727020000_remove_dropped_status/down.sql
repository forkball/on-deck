create table user_media_interactions_old (
  id integer primary key autoincrement,
  user_id integer not null references users (id) on delete cascade,
  media_item_id integer not null references media_items (id) on delete cascade,
  status text not null check (status in ('want_to_consume', 'in_progress', 'consumed', 'dropped')),
  rating real,
  notes text,
  consumed_at integer,
  created_at integer not null,
  updated_at integer not null,
  unique (user_id, media_item_id)
);

insert into user_media_interactions_old
  select id, user_id, media_item_id, status, rating, notes, consumed_at, created_at, updated_at
  from user_media_interactions;

drop table user_media_interactions;
alter table user_media_interactions_old rename to user_media_interactions;
