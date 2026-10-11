-- Credits a member earns from what they log and do, and the title they wear
-- made of two of them: a genre and a role, "Art House Projectionist". See
-- app/data/profileTitles/catalog.ts for the rules, which live in code: a credit
-- is a word and a threshold, and adding one should not take a migration.
--
-- One row per credit earned, keyed by its title_key, kept once earned. The
-- stats behind a credit can go down again (unlogging, pruned runs, an
-- unfollow), and taking one back from someone wearing it would be a strange
-- thing to notice on your own profile.
create table user_titles (
  user_id integer not null references users (id) on delete cascade,
  title_key text not null,
  unlocked_at bigint not null,
  primary key (user_id, title_key)
);

-- The title worn: its genre and its role, by title key. Either may be null: a
-- member wears a genre, a role, both or neither.
alter table users
  add column title_adjective text,
  add column title_noun text;

-- A third kind of notification, about nobody but its recipient: the credits
-- just earned, as an array of title keys. One notification per check rather
-- than per credit, so a first visit that earns eight at once is one line in
-- the list.
alter table notifications
  add column unlocked_titles jsonb;
