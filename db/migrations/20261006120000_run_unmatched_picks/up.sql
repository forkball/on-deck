-- The model's picks that no catalog entry could be found for, kept on the run
-- that was generated alongside them.
--
-- Until this, a pick the catalog search came back empty for was dropped before
-- the run was saved, and nothing said it had ever been suggested. That cost the
-- most on books: Google Books and Open Library miss real books often enough that
-- the model's answer was frequently better than the catalog's silence. A run now
-- shows those picks below its confirmed ones, as the model gave them — title,
-- year, creator and reason — with nothing that implies a catalog entry exists.
--
-- JSON text on the run rather than rows in user_recommendations: those rows point
-- at media_items, and these have no media_items row to point at. Creating one
-- would put an unconfirmed title into the shared catalog everyone logs against.
alter table recommendation_runs
  add column unmatched_picks text not null default '[]';
