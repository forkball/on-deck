drop index if exists password_reset_tokens_requested_ip_idx;
alter table password_reset_tokens drop column if exists requested_ip;
