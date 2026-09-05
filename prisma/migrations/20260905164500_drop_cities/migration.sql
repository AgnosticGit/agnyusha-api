-- Drop local cities catalog; locations come from CDEK API

DROP INDEX IF EXISTS cities_search_text_trgm;
DROP TABLE IF EXISTS "cities";
