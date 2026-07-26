create table users (
  id integer primary key autoincrement,
  email text not null unique,
  password_hash text not null,
  display_name text,
  created_at integer not null
);

create table media_items (
  id integer primary key autoincrement,
  type text not null check (type in ('movie', 'tv', 'book', 'comic', 'game')),
  external_source text not null,
  external_id text not null,
  title text not null,
  metadata text not null default '{}',
  popularity_score real,
  created_at integer not null,
  unique (type, external_source, external_id)
);

create table media_item_tags (
  media_item_id integer not null references media_items (id) on delete cascade,
  tag text not null,
  primary key (media_item_id, tag)
);
create index media_item_tags_tag_idx on media_item_tags (tag);

create table user_media_interactions (
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

create table user_taste_profiles (
  user_id integer primary key references users (id) on delete cascade,
  profile text not null default '{}',
  summary text,
  updated_at integer not null
);
