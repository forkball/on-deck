alter table users add column letterboxd_username text;

-- Deliberately not unique, unlike steam_id. A Steam link is proven by OpenID
-- and a library belongs to one person; this is an unverified claim against a
-- public page, so exclusivity here would only be enforcing a fiction.
alter table users add column letterboxd_synced_at bigint;
