-- Nothing to revert. Which nulls were 0 before isn't recorded anywhere, and
-- restoring them would mean writing zero-star ratings onto rows whose owners
-- never gave one — the reverse of this migration is not "put the 0s back", it
-- is a guess. The rows that were already unrated are indistinguishable from
-- the rows this cleared, which is the point of the change.
select 1;
