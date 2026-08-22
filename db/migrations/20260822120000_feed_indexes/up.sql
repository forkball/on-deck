-- The home page's feed asks for the newest few log rows across everyone you
-- follow. Without an index on the ordering, that plan is: walk every
-- interaction of every followed account, sort all of them, take 8 — so the
-- cost of the landing page tracks the total size of your friends' logs, and
-- this app imports whole Letterboxd and Steam libraries at a time. The
-- descending order matches the query's `order by i.updated_at desc, i.id desc`
-- so the rows come back already sorted.
create index user_media_interactions_user_recent
  on user_media_interactions (user_id, updated_at desc, id desc);

-- "Runs someone else made that included me" reads recommendation_run_members by
-- user_id, and the table's only index is its (run_id, user_id) primary key —
-- the wrong way round for that, so the read scans the whole table. It was
-- already this way on the recommendations page; the landing page is what makes
-- it a cost every visit pays.
create index recommendation_run_members_user
  on recommendation_run_members (user_id);
