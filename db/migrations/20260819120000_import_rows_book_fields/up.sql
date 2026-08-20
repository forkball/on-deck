-- Fields a book import needs that a film import did not.
--
-- log_status is the correctness one: a shelf is read, currently-reading or
-- to-read, and saveBatch wrote every row as consumed. Named for the status it
-- is logged with, so it does not read as a sibling of `state`, which is where
-- the row stands in review.
alter table import_rows add column log_status text not null default 'consumed'
  check (log_status in ('consumed', 'in_progress', 'want_to_consume'));

alter table import_rows add column author text;

-- An exact identifier, where title and year are a guess. See the identified
-- pass in resolve.ts.
alter table import_rows add column isbn text;
