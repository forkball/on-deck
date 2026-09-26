-- What the model answered when the catalog couldn't be reached.
--
-- Kept apart from recommendation_runs rather than folded into it. A row in
-- user_recommendations points at a media_items row and everything downstream
-- relies on that — the card, the log button, the rating, the feed — so admitting
-- rows without one would put a null check in every reader for the rare case. A
-- separate table says what these are: picks nothing has confirmed, which can be
-- read and nothing else.
--
-- picks is the model's own JSON, title/year/reason per entry, stored whole. There
-- is nothing to normalise into: these titles deliberately never became catalog
-- rows, which is the entire condition being recorded.
create table unconfirmed_runs (
  id integer generated always as identity primary key,
  user_id integer not null references users (id) on delete cascade,
  media_type text not null,
  params text not null,
  picks text not null,
  -- Why the catalog couldn't answer, in the words the person was shown.
  reason text not null,
  created_at bigint not null
);
create index unconfirmed_runs_user_idx on unconfirmed_runs (user_id, created_at desc);

-- Where a job that ended this way points. Beside run_id rather than reusing it:
-- the two name rows in different tables, and a single column would have to be
-- read together with a flag saying which — one more thing to get wrong on the
-- poll that decides where someone lands.
alter table recommendation_jobs
  add column unconfirmed_run_id integer references unconfirmed_runs (id) on delete set null;
