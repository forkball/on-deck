-- Staging for a CSV import, so matching can be reviewed before it reaches
-- anyone's log.
--
-- Until this existed, importLetterboxdRatings matched and wrote in one pass
-- inside the request: a wrong match landed in the log and was invisible there,
-- and the only record of what couldn't be matched was a list rendered once and
-- then lost. Both problems are the same problem — the results of matching had
-- nowhere to live.
--
-- A batch holds the parsed rows and what each one resolved to. Nothing is
-- written to user_media_interactions until the batch is saved, so every
-- decision on the review page is reversible up to that point. Catalog rows in
-- media_items are still created during matching: that table is shared
-- reference data, not anyone's log, and a row there is invisible until an
-- interaction points at it.
create table import_batches (
  id text primary key,
  user_id integer not null references users (id) on delete cascade,
  media_type text not null check (media_type in ('movie', 'tv', 'book', 'game')),
  -- Which importer produced the rows; 'letterboxd' today, and the review page
  -- is deliberately source-agnostic so goodreads and steam can follow.
  source text not null,
  status text not null check (status in ('matching', 'review', 'saving', 'done', 'failed')),
  total_rows integer not null default 0,
  -- Drives the progress line while matching runs.
  matched_rows integer not null default 0,
  -- What conflicting rows do when nobody has said otherwise. 'keep' because it
  -- is the only direction that destroys nothing.
  conflict_choice text not null default 'keep' check (conflict_choice in ('keep', 'take')),
  error text,
  -- Heartbeat for the matching worker, in the same shape as
  -- recommendation_jobs.claimed_at: no beat, no machine.
  claimed_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  completed_at bigint
);

-- Listing someone's imports, newest first.
create index import_batches_user_idx on import_batches (user_id, created_at desc);
-- The worker's claim scan, and the sweep that reclaims abandoned batches.
create index import_batches_status_idx on import_batches (status, claimed_at);

create table import_rows (
  id integer generated always as identity primary key,
  batch_id text not null references import_batches (id) on delete cascade,
  -- The line this came from in the upload, which is what the review page calls
  -- it ("row 288") so a person can find it in their own file.
  row_index integer not null,
  raw_title text not null,
  raw_year integer,
  rating numeric(3, 1),
  disliked boolean,
  notes text,
  consumed_at bigint,
  -- 'kept' is a conflict resolved in favour of what is already logged: not
  -- written, but not left out either, so the two are counted separately.
  state text not null default 'pending'
    check (state in ('pending', 'confident', 'uncertain', 'not_found', 'confirmed', 'skipped', 'kept')),
  -- Why a row is uncertain: exact | year_drift | no_year | title_differs.
  reason text,
  year_delta integer,
  matched_external_id text,
  media_item_id integer references media_items (id) on delete set null,
  created_at bigint not null,
  updated_at bigint not null,
  unique (batch_id, row_index)
);

-- Rendering a batch in file order is served by the unique (batch_id, row_index)
-- above, which is itself a btree on those columns in that order — a separate
-- index here would be the same tree maintained twice on every row written.

-- Bucketing the review page, and finding the rows a save has to write.
create index import_rows_state_idx on import_rows (batch_id, state);
-- Finding rows that landed on the same catalog entry, which is what makes a
-- duplicate detectable without loading the whole batch.
create index import_rows_item_idx on import_rows (batch_id, media_item_id);
