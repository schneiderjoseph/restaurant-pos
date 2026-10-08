-- Drop the inventory, recipe/production, buffet, kitchen-reconciliation and HR/labor/payroll
-- tables. Those modules were removed from the POS (bbdf87a3, 0453e1fe, a47f7760): stock and
-- food cost now live in Optimum Control, payroll and attendance in ZYPAY. No code reads or
-- writes these tables anymore and no remaining table, event or function references them.
-- Kept on purpose (still used by the POS): time_entry (clock-in sessions), shift,
-- tip_distribution, tip_distribution_user_share.
-- Destructive: take a database export first (update-asi-prod.ps1 does). Idempotent.

REMOVE TABLE IF EXISTS buffet_consumption_log;
REMOVE TABLE IF EXISTS buffet_guest_count;
REMOVE TABLE IF EXISTS buffet_menu;
REMOVE TABLE IF EXISTS buffet_menu_item;
REMOVE TABLE IF EXISTS buffet_production_batch;
REMOVE TABLE IF EXISTS buffet_session;
REMOVE TABLE IF EXISTS buffet_stock_snapshot;
REMOVE TABLE IF EXISTS buffet_waste_log;
REMOVE TABLE IF EXISTS cost_center;
REMOVE TABLE IF EXISTS department;
REMOVE TABLE IF EXISTS employee;
REMOVE TABLE IF EXISTS employee_assignment_history;
REMOVE TABLE IF EXISTS employee_document;
REMOVE TABLE IF EXISTS employee_pay_profile;
REMOVE TABLE IF EXISTS employee_performance_note;
REMOVE TABLE IF EXISTS inventory_adjustment;
REMOVE TABLE IF EXISTS inventory_adjustment_item;
REMOVE TABLE IF EXISTS inventory_category;
REMOVE TABLE IF EXISTS inventory_issue;
REMOVE TABLE IF EXISTS inventory_issue_item;
REMOVE TABLE IF EXISTS inventory_issue_return;
REMOVE TABLE IF EXISTS inventory_issue_return_item;
REMOVE TABLE IF EXISTS inventory_item;
REMOVE TABLE IF EXISTS inventory_item_group;
REMOVE TABLE IF EXISTS inventory_item_group_item;
REMOVE TABLE IF EXISTS inventory_item_waste;
REMOVE TABLE IF EXISTS inventory_item_waste_item;
REMOVE TABLE IF EXISTS inventory_ledger;
REMOVE TABLE IF EXISTS inventory_location;
REMOVE TABLE IF EXISTS inventory_purchase;
REMOVE TABLE IF EXISTS inventory_purchase_item;
REMOVE TABLE IF EXISTS inventory_purchase_order;
REMOVE TABLE IF EXISTS inventory_purchase_order_item;
REMOVE TABLE IF EXISTS inventory_purchase_payment;
REMOVE TABLE IF EXISTS inventory_purchase_return;
REMOVE TABLE IF EXISTS inventory_purchase_return_item;
REMOVE TABLE IF EXISTS inventory_store;
REMOVE TABLE IF EXISTS inventory_supplier;
REMOVE TABLE IF EXISTS kitchen_complimentary_item;
REMOVE TABLE IF EXISTS kitchen_reconciliation;
REMOVE TABLE IF EXISTS kitchen_reconciliation_item;
REMOVE TABLE IF EXISTS kitchen_reconciliation_revision;
REMOVE TABLE IF EXISTS kitchen_staff_meal;
REMOVE TABLE IF EXISTS kitchen_stock_count;
REMOVE TABLE IF EXISTS kitchen_waste;
REMOVE TABLE IF EXISTS labor_adjustment;
REMOVE TABLE IF EXISTS labor_audit_log;
REMOVE TABLE IF EXISTS labor_cost_event;
REMOVE TABLE IF EXISTS labor_pay_rule;
REMOVE TABLE IF EXISTS labor_policy;
REMOVE TABLE IF EXISTS leave_balance;
REMOVE TABLE IF EXISTS leave_request;
REMOVE TABLE IF EXISTS leave_type;
REMOVE TABLE IF EXISTS menu_item_recipe;
REMOVE TABLE IF EXISTS payroll_period;
REMOVE TABLE IF EXISTS payroll_run;
REMOVE TABLE IF EXISTS payroll_snapshot;
REMOVE TABLE IF EXISTS position;
REMOVE TABLE IF EXISTS production_batch;
REMOVE TABLE IF EXISTS production_batch_input;
REMOVE TABLE IF EXISTS production_batch_output;
REMOVE TABLE IF EXISTS public_holiday;
REMOVE TABLE IF EXISTS recipe;
REMOVE TABLE IF EXISTS recipe_item;
REMOVE TABLE IF EXISTS recipe_output;
REMOVE TABLE IF EXISTS schedule_template;
REMOVE TABLE IF EXISTS scheduled_shift;
REMOVE TABLE IF EXISTS shift_swap_request;
REMOVE TABLE IF EXISTS stock_transfer;
REMOVE TABLE IF EXISTS stock_transfer_item;
REMOVE TABLE IF EXISTS time_entry_break;
REMOVE TABLE IF EXISTS work_schedule;
