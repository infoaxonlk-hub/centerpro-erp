-- Run and commit BEFORE 018_sales_workflow.sql.
alter type public.stock_movement_type add value if not exists 'sale_out';
alter type public.cash_movement_type add value if not exists 'sale_receipt';
