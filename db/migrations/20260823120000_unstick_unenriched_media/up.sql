-- Rows that were stamped as enriched by an import.
--
-- metadata.enrichedAt means "the by-id record has been fetched, stop asking",
-- and it is the only thing the detail page checks before backfilling. Until the
-- change alongside this migration, upsertCatalogItem stamped it for every
-- caller, including the three that hand it search results — a CSV import, a
-- Steam sync, a recommendation run. Those rows carry search-grade metadata and
-- claim to be finished, so the backfill never runs and the credit line and
-- runtime stay empty for good.
--
-- Clearing the stamp is what lets the next view fetch the record. The test is
-- the field only a by-id lookup returns, per type: no search result carries it,
-- so its absence means no lookup has landed. A genuine lookup that returned no
-- runtime (an unreleased film) is re-fetched once and stamps itself again.
update media_items
   set metadata = metadata - 'enrichedAt'
 where metadata ? 'enrichedAt'
   and metadata->>'enrichedAt' is not null
   and case type
         when 'book' then metadata->>'pageCount' is null
         when 'game' then metadata->>'playtimeHours' is null
         when 'tv' then metadata->>'seasonCount' is null
         else metadata->>'runtimeMinutes' is null
       end;
