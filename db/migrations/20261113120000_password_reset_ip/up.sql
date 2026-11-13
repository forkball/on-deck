-- The address a reset link was requested from, for the per-IP cap in
-- app/data/passwordResets/tokens.ts. The per-account cap stops one inbox being
-- flooded; this one stops a single address walking a list of accounts and
-- spending the day's sending quota so nobody else's link goes out.
--
-- Null where the address isn't known — requests made before this column, and
-- anything not served through Fly's proxy. Those are only held to the
-- per-account cap.
alter table password_reset_tokens add column requested_ip text;

create index password_reset_tokens_requested_ip_idx
  on password_reset_tokens (requested_ip, created_at)
  where requested_ip is not null;
