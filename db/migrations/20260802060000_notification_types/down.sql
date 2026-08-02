drop index if exists notifications_follow_once;
delete from notifications where type <> 'recommendation';
alter table notifications alter column run_id set not null;
alter table notifications drop column type;
