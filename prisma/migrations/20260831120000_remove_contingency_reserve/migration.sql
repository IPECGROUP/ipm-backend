-- The contingency reserve is no longer part of liquidity allocation.
-- Remove only the rows created for that feature; project allocations and totals
-- are preserved.
DELETE FROM "liquidity_allocations"
WHERE "row_type" = 'contingency_reserve';
