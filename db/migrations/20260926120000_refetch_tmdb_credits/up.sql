-- Movies and shows fetched before the detail lookup kept a cast, every
-- director or creator, and the tagline — and, for a show, its episode count,
-- status and networks.
--
-- A movie's by-id record already carried all of it; the lookup read the first
-- director out and dropped the rest. A show's needed aggregate_credits added to
-- the request. Either way metadata.enrichedAt is what stops the detail page
-- asking again, so without clearing it those rows would go without a cast for
-- good while every title added afterwards has one.
--
-- Clearing the stamp is what lets the next view fetch the record, the same way
-- 20260823120000 did: one lookup per title, spread across the page views that
-- need it, rather than a burst against TMDB. A row that already has a cast
-- could only have got it from the new lookup, so it is left alone.
update media_items
   set metadata = metadata - 'enrichedAt'
 where type in ('movie', 'tv')
   and external_source = 'tmdb'
   and metadata->>'enrichedAt' is not null
   and coalesce(jsonb_array_length(metadata->'cast'), 0) = 0;
