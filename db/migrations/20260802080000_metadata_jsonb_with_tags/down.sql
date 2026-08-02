-- Rebuilds media_item_tags from metadata.tags, then puts the column back to
-- text. `distinct` because nothing constrains the JSON array to be unique the
-- way the table's primary key did.
set lock_timeout = '5s';

create table media_item_tags (
  media_item_id integer not null references media_items (id) on delete cascade,
  tag text not null,
  primary key (media_item_id, tag)
);
create index media_item_tags_tag_idx on media_item_tags (tag);

insert into media_item_tags (media_item_id, tag)
select distinct mi.id, tag
from media_items mi,
     lateral jsonb_array_elements_text(mi.metadata -> 'tags') as tag
where jsonb_typeof(mi.metadata -> 'tags') = 'array';

update media_items set metadata = metadata - 'tags';

drop index if exists media_items_metadata_gin;

-- The default has to go before the type change and come back after, since
-- '{}'::jsonb is not a valid default for a text column.
alter table media_items
  alter column metadata drop default;

alter table media_items
  alter column metadata type text using metadata::text;

alter table media_items
  alter column metadata set default '{}';
