-- Rename additives → description, nutrition_kcal → nutrition_carbs
ALTER TABLE "products" RENAME COLUMN "additives" TO "description";
ALTER TABLE "products" RENAME COLUMN "nutrition_kcal" TO "nutrition_carbs";
