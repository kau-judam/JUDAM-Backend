-- Backfill: restore recipe.status for recipes stuck in FUNDING_IN_PROGRESS
-- after their funding was voided (REJECTED/CANCELED) without status restoration.
--
-- Until now, approving a funding set recipes.status = 'FUNDING_IN_PROGRESS',
-- but rejecting/canceling that funding did NOT restore it. Such recipes remain
-- hidden from the recipe tab / popular list and cannot be re-funded or deleted.
--
-- A recipe is restored only when it has NO living (non-voided) funding left.
-- Target status: FUNDING_READY when interest meets the threshold (>= 100),
-- otherwise PUBLISHED. Mirrors the live restore in
-- recipeService.restoreRecipeStatusAfterVoidedFunding.

UPDATE recipes r
SET
  status = CASE WHEN r.interest_count >= 100 THEN 'FUNDING_READY' ELSE 'PUBLISHED' END,
  updated_at = CURRENT_TIMESTAMP
WHERE r.status = 'FUNDING_IN_PROGRESS'
  AND NOT EXISTS (
    SELECT 1 FROM funding_projects fp
    WHERE fp.recipe_id = r.recipe_id
      AND fp.status NOT IN ('REJECTED', 'CANCELED')
  );
