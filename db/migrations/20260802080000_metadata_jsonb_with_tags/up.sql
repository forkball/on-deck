-- Two changes to how a catalog item's metadata is stored.
--
-- 1. media_items.metadata becomes jsonb instead of text.
--
-- It always held JSON, but as an opaque string the database could not
-- validate it (which is why parseMediaMetadata needs a try/catch), could not
-- index it, and could not answer containment queries.
--
-- 2. media_item_tags is folded into that blob as `tags`.
--
-- The table was never used as a relation: `tag` was a bare string with no
-- entity behind it, no foreign key and no vocabulary constraint; every one of
-- its five call sites keyed on media_item_id; and nothing ever queried by tag,
-- so media_item_tags_tag_idx was dead weight. The data is the same shape and
-- provenance as `images` and `platforms`, which already live in the blob and
-- are wholesale-replaced by the provider the same way.
--
-- The GIN index below is what makes this a fair trade rather than a loss:
-- `metadata @> '{"tags":["horror"]}'` is now answerable from an index, which
-- the join table's own index never actually delivered.
--
-- NOT BACKWARD COMPATIBLE. pg returns a jsonb column as a parsed object, so
-- code doing JSON.parse on it breaks — silently, via parseMediaMetadata's
-- catch, blanking every poster/year/overview. Deploy with no old version
-- running: stop the machines, migrate, deploy, start them again.

-- Fail fast rather than queueing behind a slow query and stalling every read
-- of media_items while the rewrite waits for its lock.
set lock_timeout = '5s';

-- The existing default is the text literal '{}', which Postgres refuses to
-- cast implicitly ("default for column metadata cannot be cast automatically
-- to type jsonb"), so it has to come off before the type change and go back
-- on after.
alter table media_items
  alter column metadata drop default;

-- Rewrites the table. Aborts if any row holds invalid JSON, which is what we
-- want — better a failed deploy than silently discarded metadata.
alter table media_items
  alter column metadata type jsonb using metadata::jsonb;

alter table media_items
  alter column metadata set default '{}'::jsonb;

update media_items mi
set metadata = mi.metadata || jsonb_build_object('tags', t.tags)
from (
  select media_item_id, jsonb_agg(tag order by tag) as tags
  from media_item_tags
  group by media_item_id
) t
where t.media_item_id = mi.id;

drop index if exists media_item_tags_tag_idx;
drop table if exists media_item_tags;

create index media_items_metadata_gin on media_items using gin (metadata);
