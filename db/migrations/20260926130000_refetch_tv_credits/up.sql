-- Shows fetched before the TV detail lookup asked for aggregate_credits and kept
-- the episode count, status, networks and every creator.
--
-- The same move as 20260926120000 made for movies: enrichedAt is what stops the
-- detail page asking again, so clearing it is what gets these rows their cast.
-- One lookup per show, on its next view. A row with a cast could only have got
-- it from the new lookup, so it is left alone.
update media_items
   set metadata = metadata - 'enrichedAt'
 where type = 'tv'
   and external_source = 'tmdb'
   and metadata->>'enrichedAt' is not null
   and coalesce(jsonb_array_length(metadata->'cast'), 0) = 0;
