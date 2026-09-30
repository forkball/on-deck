-- What the Open Library → Google Books backfill already tried, so a second run
-- doesn't pay for the same answers again (scripts/backfill-google-books.ts).
--
-- The leak this closes: a row the backfill can't match keeps external_source =
-- 'openlibrary', so it is still in the set the next run selects. Measured on 30
-- rows, 16 of them end somewhere other than a match — so over half the job's
-- Google Books requests were being spent re-deriving failures already known,
-- against a quota the live app shares.
--
-- Its own table rather than a column on media_items, because it is process
-- state, not something about the book: those rows are shared by everyone who
-- logged the work, and this has no business being read with them.
create table book_backfill_attempts (
  media_item_id integer primary key references media_items (id) on delete cascade,
  -- 'no-isbn', 'no-google-hit', 'title-mismatch' and the like. Whether an
  -- outcome is worth retrying is the script's rule, not the schema's.
  outcome text not null,
  detail text not null,
  attempted_at bigint not null
);
