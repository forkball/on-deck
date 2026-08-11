-- Drops the dislikes with the column. There is nowhere to put them: the rating
-- scale bottoms out at 0.5, and writing that onto a dislike would invent a
-- score the person deliberately declined to give.
alter table user_media_interactions drop column disliked;
