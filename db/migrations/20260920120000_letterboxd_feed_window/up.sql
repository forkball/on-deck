-- What the last sync saw of the feed, so the next one can tell a feed that was
-- truncated from a feed that shrank.
--
-- The delete pass reads "absent from the feed" against a watermark: the oldest
-- entry the feed currently shows. Everything published after it would still be
-- carried if it existed, so its absence is a deletion; everything before it is
-- out of view, which is not the same as gone.
--
-- That rule eats itself at the bottom of the window. Delete the oldest entry
-- the feed shows and, with nothing older to backfill, the watermark rises to
-- the next one — so the row that just went now sits *below* the window it used
-- to define, and the guard written to protect the back catalogue protects it
-- instead. Permanently: in a diary that fits inside the feed, the watermark
-- only climbs as more films are logged, so the orphan sinks further out of
-- reach with every one.
--
-- Telling the two apart needs the previous fetch, because the current one
-- cannot say why its floor moved. Truncation happens when the feed is full and
-- something new arrives, and a full feed that truncates keeps its item count.
-- So a count that *fell* is a feed that lost items with nothing refilling it —
-- nothing was pushed out, and the window still reaches wherever it reached
-- last time.
alter table users add column letterboxd_feed_floor bigint;

-- Raw <item> count, lists included, rather than the diary entries parsed out of
-- it. A new list can push a diary entry out of a full feed exactly as a new
-- diary entry can, and counting only the entries would read that truncation as
-- a deletion — which is the one mistake that destroys a row.
alter table users add column letterboxd_feed_items integer;
