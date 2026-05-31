-- The shopping list was tied to a single menu (`menu_id`) and covered its
-- 7 days. We now treat the list as a rolling window per user/household
-- with a configurable date range that may span multiple menus.
--
-- `range_start_date` / `range_end_date` are inclusive. The route always
-- overwrites them on regenerate so a single row per household tracks the
-- "current shopping list" — manual items + check state survive when the
-- range advances day by day.
ALTER TABLE "shopping_lists"
  ADD COLUMN IF NOT EXISTS "range_start_date" date,
  ADD COLUMN IF NOT EXISTS "range_end_date" date;
