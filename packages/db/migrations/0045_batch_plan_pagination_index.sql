CREATE INDEX "job_work_items_job_user_order_idx" ON "job_work_items" USING btree ("job_id","user_id","sort_order","id");
