/**
 * WHERE clause of the customers still in use: not soft-deleted, not merged into another.
 * Holds on a database without migrations/2026_10_06_customer_management.surql too
 * (a missing field is NONE).
 */
export const ACTIVE_CUSTOMER = 'deleted_at = NONE AND merged_into = NONE';
