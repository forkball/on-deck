-- Movies fetched before the detail lookup kept its cast, every director and the
-- tagline.
--
-- The by-id record already carried all three; the lookup read the first
-- director out of it and dropped the rest. metadata.enrichedAt is what stops
-- the detail page asking again, so without clearing it those rows would go
-- without a cast for good while every movie added afterwards has one.
--
-- Clearing the stamp is what lets the next view fetch the record, the same way
-- 20260823120000 did: one lookup per movie, spread across the page views that
-- need it, rather than a burst against TMDB. A row that already has a cast
-- could only have got it from the new lookup, so it is left alone.
update media_items
   set metadata = metadata - 'enrichedAt'
 where type = 'movie'
   and external_source = 'tmdb'
   and metadata->>'enrichedAt' is not null
   and coalesce(jsonb_array_length(metadata->'cast'), 0) = 0;
