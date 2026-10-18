-- PRO-196 (Miguel, 2026-10-18, answer B, explicit OK to touch catalogue data):
-- Cocina tagged `gluten` by prudence on cured meats whose gluten depends on
-- the brand (2026-10-17). The tag goes; a coeliac household now gets these
-- recipes with «<embutido> sin gluten» on the list and «Elige embutido sin
-- gluten» on the recipe (services/glutenFreeCharcuterie.ts). The cocido
-- leftovers keep theirs (PRO-198). One-shot: a tag Cocina sets later stays.
UPDATE "ingredients"
SET "allergen_tags" = array_remove("allergen_tags", 'gluten'), "updated_at" = now()
WHERE lower("name") IN (
  'chorizo oreado', 'morcilla de cebolla', 'butifarra blanca', 'butifarra negra',
  'salchichas frescas', 'foie gras de untar', 'jamón de york'
) AND 'gluten' = ANY("allergen_tags");
--> statement-breakpoint
-- Recipes that use them drop `gluten` from their stored allergen union unless
-- another of their ingredients still carries the catalogue tag (the ficha and
-- the filter also infer it from the names on read, e.g. «pan»).
UPDATE "recipes" r
SET "allergens" = array_remove(r."allergens", 'gluten')
WHERE 'gluten' = ANY(r."allergens")
  AND EXISTS (
    SELECT 1 FROM "recipe_ingredients" ri JOIN "ingredients" i ON i."id" = ri."ingredient_id"
    WHERE ri."recipe_id" = r."id" AND lower(i."name") IN (
      'chorizo oreado', 'morcilla de cebolla', 'butifarra blanca', 'butifarra negra',
      'salchichas frescas', 'foie gras de untar', 'jamón de york'
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM "recipe_ingredients" ri JOIN "ingredients" i ON i."id" = ri."ingredient_id"
    WHERE ri."recipe_id" = r."id" AND 'gluten' = ANY(i."allergen_tags")
  );
