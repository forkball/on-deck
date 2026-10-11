-- Titles a member earns from what they log and do — "Art House Projectionist" — and the
-- pair they have chosen to wear. See app/data/profileTitles/catalog.ts for the
-- rules, which live in code: a title is a few words and a threshold, and adding
-- one should not take a migration.
--
-- One row per title earned, kept once earned. The stats behind a title can go
-- down again (unlogging, pruned runs, an unfollow), and taking a title back from
-- someone wearing it would be a strange thing to notice on your own profile.
create table user_titles (
  user_id integer not null references users (id) on delete cascade,
  title_key text not null,
  unlocked_at bigint not null,
  primary key (user_id, title_key)
);

-- The chosen halves, by title key. Either may be null: a member wears an
-- adjective, a noun, both or neither.
alter table users
  add column title_adjective text,
  add column title_noun text;

-- A third kind of notification, about nobody but its recipient: the titles just
-- unlocked, as an array of keys. One notification per check rather than per
-- title, so a first visit that unlocks eight at once is one line in the list.
alter table notifications
  add column unlocked_titles jsonb;
