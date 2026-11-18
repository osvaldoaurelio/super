ALTER TABLE "stores" ADD COLUMN "latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "longitude" numeric(9, 6);--> statement-breakpoint
CREATE INDEX "stores_coordinates_idx" ON "stores" USING btree ("latitude","longitude");--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_coordinates_pair_check" CHECK (("stores"."latitude" is null) = ("stores"."longitude" is null));--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_latitude_bounds_check" CHECK ("stores"."latitude" is null or "stores"."latitude" between -90 and 90);--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_longitude_bounds_check" CHECK ("stores"."longitude" is null or "stores"."longitude" between -180 and 180);