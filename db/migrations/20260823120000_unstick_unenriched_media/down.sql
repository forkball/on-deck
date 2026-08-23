-- Nothing to undo. The stamps this cleared were false claims that a by-id
-- lookup had happened, and the rows that need one re-stamp themselves on the
-- next view; putting the old timestamps back would need them kept somewhere,
-- which is not worth a column.
select 1;
