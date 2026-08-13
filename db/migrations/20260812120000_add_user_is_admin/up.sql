-- The first role the app has had. It grants nothing today except exemption
-- from the per-24h recommendation cap (app/data/recommendations/dailyLimit.ts):
-- that cap exists to bound what one account can spend on model and catalog
-- calls, and the people running the thing need to be able to exercise it
-- without being throttled by it.
--
-- Deliberately with no UI to set it. Admin is a maintenance role, not something
-- users hand each other, so it is granted out of band:
--   node --env-file-if-exists=.env --import remix/node-tsx scripts/set-admin.ts <email-or-username>
alter table users add column is_admin boolean not null default false;
