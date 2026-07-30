alter table recommendation_runs add column media_type text not null default 'movie';
alter table recommendation_runs alter column media_type drop default;
