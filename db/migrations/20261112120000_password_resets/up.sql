-- "Forgot your password?": one row per reset link emailed. The link carries a
-- random token; only its SHA-256 is stored, so a copy of this table can't be
-- used to reset anyone's password. See app/data/passwordResets/.
--
-- Kept after use rather than deleted: used_at is what makes a link single-use,
-- and created_at is what the per-account rate limit counts.
create table password_reset_tokens (
  id serial primary key,
  user_id integer not null references users (id) on delete cascade,
  token_hash text not null unique,
  created_at bigint not null,
  expires_at bigint not null,
  used_at bigint
);

create index password_reset_tokens_user_id_idx on password_reset_tokens (user_id, created_at);

-- Sessions live entirely in a signed cookie, so there is no server-side list to
-- delete them from. Instead each cookie carries the version it was issued
-- under, and changing the password bumps it: every cookie issued before stops
-- verifying. Cookies written before this column existed carry no version and
-- read as 0, which is what everyone starts on — so nobody is logged out by the
-- migration itself.
alter table users add column session_version integer not null default 0;
