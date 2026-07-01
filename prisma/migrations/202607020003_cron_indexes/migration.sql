-- Cross-shop cron scan indexes.
-- The reminder/overdue cron queries filter NasiyaSchedule by (status, dueDate)
-- and Sale by (paidFully, dueDate) WITHOUT a shopId predicate, so the existing
-- shopId-leading composite indexes cannot serve them. These non-shop-leading
-- indexes back the daily cron scans.
--
-- NOTE: on a large existing table, create these CONCURRENTLY by hand instead
-- (CREATE INDEX CONCURRENTLY cannot run inside Prisma's migration transaction).

CREATE INDEX "NasiyaSchedule_status_dueDate_idx" ON "NasiyaSchedule"("status", "dueDate");

CREATE INDEX "Sale_paidFully_dueDate_idx" ON "Sale"("paidFully", "dueDate");
