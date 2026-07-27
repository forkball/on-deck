-- Squashed schema for the move from SQLite to Postgres (Supabase). Replaces
-- the five prior SQLite-dialect migrations, which included a table getting
-- dropped/recreated and a column getting added then removed — no point
-- replaying dead-end states in a different SQL dialect. Timestamps are
-- bigint (epoch milliseconds, written by the app as Date.now()), not
-- Postgres's native timestamp types, to match existing application code.

create table users (
  id integer generated always as identity primary key,
  email text not null unique,
  password_hash text not null,
  display_name text,
  created_at bigint not null
);

create table media_items (
  id integer generated always as identity primary key,
  type text not null check (type in ('movie', 'tv', 'book', 'comic', 'game')),
  external_source text not null,
  external_id text not null,
  title text not null,
  metadata text not null default '{}',
  popularity_score numeric(10, 2),
  created_at bigint not null,
  unique (type, external_source, external_id)
);

create table media_item_tags (
  media_item_id integer not null references media_items (id) on delete cascade,
  tag text not null,
  primary key (media_item_id, tag)
);
create index media_item_tags_tag_idx on media_item_tags (tag);

create table user_media_interactions (
  id integer generated always as identity primary key,
  user_id integer not null references users (id) on delete cascade,
  media_item_id integer not null references media_items (id) on delete cascade,
  status text not null check (status in ('want_to_consume', 'in_progress', 'consumed')),
  rating numeric(3, 1),
  notes text,
  consumed_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  unique (user_id, media_item_id)
);

create table user_taste_profiles (
  user_id integer primary key references users (id) on delete cascade,
  profile text not null default '{}',
  summary text,
  updated_at bigint not null
);

create table user_follows (
  follower_id integer not null references users (id) on delete cascade,
  followed_id integer not null references users (id) on delete cascade,
  created_at bigint not null,
  primary key (follower_id, followed_id)
);

create table recommendation_runs (
  id integer generated always as identity primary key,
  user_id integer not null references users (id) on delete cascade,
  created_at bigint not null
);
create index recommendation_runs_user_idx on recommendation_runs (user_id);

create table recommendation_run_members (
  run_id integer not null references recommendation_runs (id) on delete cascade,
  user_id integer not null references users (id) on delete cascade,
  primary key (run_id, user_id)
);

create table user_recommendations (
  id integer generated always as identity primary key,
  run_id integer not null references recommendation_runs (id) on delete cascade,
  media_item_id integer not null references media_items (id) on delete cascade,
  reason text not null,
  rank integer not null
);
create index user_recommendations_run_idx on user_recommendations (run_id);
