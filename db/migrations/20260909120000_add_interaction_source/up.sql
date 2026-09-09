-- Where a log row came from, so the Letterboxd sync can tell rows it created
-- apart from rows a member wrote by hand.
--
-- Until now nothing distinguished them: a film logged in on-deck and the same
-- film synced from a diary entry produce byte-identical rows. That is fine
-- while the sync only ever adds, but it makes deletion impossible to do safely
-- — "in the log, absent from the feed" describes every film a member logged
-- here directly, and removing those is the opposite of what they asked for.
--
-- Null on every existing row, and null means "never auto-delete". This
-- migration is therefore inert on the data already stored: the delete pass can
-- only ever reach rows written after it, by a source that claimed them.
alter table user_media_interactions add column source text;

-- The pubDate of the diary entry this row was last synced from — when the
-- entry was *published* to the diary, not when the film was watched.
--
-- The distinction is the whole point. The RSS feed carries a bounded number of
-- the most recently published entries, so "published after X" is a statement
-- about what the feed still covers, while "watched after X" is not:
-- letterboxd:watchedDate is user-settable and routinely backdated, so a member
-- logging a 2019 film today would drag any watched-date watermark back to 2019
-- and put six years of their log inside the deletable window.
--
-- Unlike source, this is rewritten on every sync. A rewatch publishes a new
-- entry for a film already logged, and it is the newest entry that decides
-- whether the feed can still speak for that row.
alter table user_media_interactions add column source_entry_at bigint;

-- The delete pass scans one member's feed-sourced rows. Partial, because that
-- is a small slice of a table that is mostly rows this index would never serve.
create index user_media_interactions_source_idx
  on user_media_interactions (user_id, source)
  where source is not null;
