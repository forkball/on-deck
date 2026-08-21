drop index if exists recommendation_runs_lucky_user_created;
alter table recommendation_runs drop column if exists is_lucky;
