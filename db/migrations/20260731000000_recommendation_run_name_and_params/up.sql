alter table recommendation_runs add column name text;
alter table recommendation_runs add column params text not null default '{}';
