-- Emails are now normalised to lowercase on write (see data/users.ts), which
-- is what makes the unique index the case-insensitive check it was always
-- assumed to be. Existing rows have to follow, or logging in with an address
-- that was stored with capitals stops finding its row.
--
-- No conflict handling: if two rows differ only in case they are already two
-- accounts one person can't tell apart, and the unique violation raised here
-- is the right way to find that out rather than picking a winner silently.
update users set email = lower(email) where email <> lower(email);
