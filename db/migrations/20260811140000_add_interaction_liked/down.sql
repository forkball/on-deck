-- Drops the verdicts with the column. There is nowhere else to put them: a
-- rating is a different question, and writing one from a like would invent a
-- score nobody gave.
alter table user_media_interactions drop column liked;
