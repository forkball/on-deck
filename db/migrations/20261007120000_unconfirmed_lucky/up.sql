-- Whether an unconfirmed run came from a lucky draw.
--
-- A lucky draw the catalog couldn't answer is kept as an unconfirmed run, like
-- any other, but it is still one pick drawn for the day, and its page should read
-- like the lucky pick it stands in for rather than like a failed shortlist.
-- Nothing else tells the two apart: the params of a lucky draw are empty, which
-- an ordinary run with no levers set also has.
alter table unconfirmed_runs
  add column is_lucky boolean not null default false;
