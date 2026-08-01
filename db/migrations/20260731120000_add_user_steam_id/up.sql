alter table users add column steam_id text;
-- One Steam account per On Deck account, and vice versa: without this a
-- second user could link the same library.
create unique index users_steam_id_key on users (steam_id) where steam_id is not null;
