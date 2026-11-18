ALTER TABLE "current_prices" ADD COLUMN "price_type" varchar(16) DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "price_history" ADD COLUMN "price_type" varchar(16) DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unit_measure" varchar(16) DEFAULT 'unit' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unit_quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "current_prices_store_product_idx" ON "current_prices" USING btree ("store_id","product_id");--> statement-breakpoint
ALTER TABLE "current_prices" ADD CONSTRAINT "current_prices_price_type_valid" CHECK ("current_prices"."price_type" in ('regular', 'promo'));--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_price_type_valid" CHECK ("price_history"."price_type" in ('regular', 'promo'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_unit_measure_valid" CHECK ("products"."unit_measure" in ('unit', 'g', 'ml'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_unit_quantity_positive" CHECK ("products"."unit_quantity" > 0);