-- Lets someone say what their taste profile is written from, instead of it
-- always being the whole log.
--
-- Two knobs. `profile_log_limit` is how many of the most recent entries the
-- prompt is built from — null means all of them, which is what everyone gets
-- today, so the default preserves current behaviour. `profile_use_notes`
-- decides whether the notes people write on their own entries are sent at all.
--
-- Per account rather than per media type: one answer to "how far back should
-- this look" is easier to hold in your head than four, and nothing yet
-- suggests people want them to differ.
alter table users add column profile_log_limit integer;
alter table users add column profile_use_notes boolean not null default true;

-- Rebuilding is a model call someone can now ask for directly, so it needs the
-- same kind of ceiling generating already has. Its own ledger for the same
-- reason recommendation_run_usage is its own: the thing being counted is the
-- call, and the row it produces gets overwritten rather than accumulated.
create table profile_rebuild_usage (
  id integer generated always as identity primary key,
  user_id integer not null references users (id) on delete cascade,
  created_at bigint not null
);

-- The window is read per user and swept on write, so both want this.
create index profile_rebuild_usage_user_created on profile_rebuild_usage (user_id, created_at);
