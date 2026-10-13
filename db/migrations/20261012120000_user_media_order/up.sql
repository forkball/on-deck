-- The order someone wants the media-type tabs in, on search, recommendations
-- and profiles. Null is the default order, which is what everyone starts on.
alter table users add column media_order text;
