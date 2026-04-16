-- Add discount_amount to service_orders
ALTER TABLE "service_orders" ADD COLUMN "discount_amount" integer DEFAULT 0;
