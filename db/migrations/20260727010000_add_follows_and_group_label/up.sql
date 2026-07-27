create table user_follows (
  follower_id integer not null references users (id) on delete cascade,
  followed_id integer not null references users (id) on delete cascade,
  created_at integer not null,
  primary key (follower_id, followed_id)
);

alter table user_recommendations add column group_label text;
