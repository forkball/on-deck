-- Where a movie or show can be watched, per country, as TMDB reports it (its
-- data comes from JustWatch).
--
-- A table of its own rather than a key in media_items.metadata, for two
-- reasons. It goes stale, where everything in metadata stays true once fetched:
-- a show leaves a service, so this is refetched on a clock and needs its own
-- fetched_at, which metadata.enrichedAt cannot double as. And it is large — one
-- response covers every country at once, which is what lets someone switch
-- country without another request — so keeping it out of metadata keeps it out
-- of every list query that reads that column.
create table media_watch_providers (
  media_item_id integer primary key references media_items (id) on delete cascade,
  -- { "<country code>": { link, stream: [...], free: [...], ads: [...] } }
  regions jsonb not null,
  fetched_at bigint not null
);

-- Which country's services someone is shown. Null means "guess from the
-- browser", which is what everyone starts on; a value is a choice they made.
alter table users add column watch_region text;
