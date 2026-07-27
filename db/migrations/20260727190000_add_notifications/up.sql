create table notifications (
  id integer generated always as identity primary key,
  user_id integer not null references users (id) on delete cascade,
  actor_user_id integer not null references users (id) on delete cascade,
  run_id integer not null references recommendation_runs (id) on delete cascade,
  read_at bigint,
  created_at bigint not null
);
create index notifications_user_idx on notifications (user_id, created_at desc);
