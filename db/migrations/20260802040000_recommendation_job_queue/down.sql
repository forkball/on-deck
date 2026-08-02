drop index if exists recommendation_jobs_status_created;
alter table recommendation_jobs drop column attempts;
alter table recommendation_jobs drop column claimed_at;
alter table recommendation_jobs drop column checkpoint;
alter table recommendation_jobs drop column params;
alter table recommendation_jobs drop column status;
