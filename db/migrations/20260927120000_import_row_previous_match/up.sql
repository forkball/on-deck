-- The match a row had before someone picked a different film for it, so undoing
-- that pick restores it: { "mediaItemId": 1, "externalId": "…", "yearDelta": 1 }.
-- Written on the first pick only, cleared when the row is reopened. Null for
-- rows nobody has repointed.
alter table import_rows add column previous_match jsonb;
