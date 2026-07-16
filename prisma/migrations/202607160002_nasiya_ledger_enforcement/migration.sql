-- Stage 2: Nasiya ledger enforcement.
--
-- Apply only after the count-only dry-run has been reviewed, a PITR/backup
-- checkpoint has been verified, and the approved cache-only repair reports
-- zero unexplained mismatches. The opening gate makes a direct
-- `prisma migrate deploy` fail safely if someone attempts this too early.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Nasiya" n
    LEFT JOIN "NasiyaSchedule" s ON s."nasiyaId" = n.id
    GROUP BY n.id, n."contractFinalAmount", n."contractPaidAmount", n."contractRemainingAmount"
    HAVING COUNT(s.id) = 0
       OR SUM(s."contractExpectedAmount") <> n."contractFinalAmount"
       OR SUM(s."contractPaidAmount") <> n."contractPaidAmount"
       OR SUM(s."contractRemainingAmount") <> n."contractRemainingAmount"
       OR SUM(s."contractExpectedAmount") <> SUM(s."contractPaidAmount") + SUM(s."contractRemainingAmount")
       OR BOOL_OR(s."contractCurrency" <> n."contractCurrency")
  ) THEN
    RAISE EXCEPTION
      'Nasiya ledger enforcement is blocked: run and review the dry-run repair, verify PITR, then repair only deterministic parent caches first';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Nasiya" n
    JOIN "NasiyaSchedule" s ON s."nasiyaId" = n.id
    LEFT JOIN "NasiyaPaymentAllocation" a
      ON a."nasiyaScheduleId" = s.id AND a."nasiyaId" = n.id
    WHERE n."accountingReconstructionStatus" = 'COMPLETE'
    GROUP BY s.id, s."contractPaidAmount"
    HAVING COALESCE(SUM(a."contractAmount"), 0) <> s."contractPaidAmount"
  ) THEN
    RAISE EXCEPTION
      'Nasiya ledger enforcement is blocked: complete allocation history disagrees with schedules';
  END IF;
END;
$$;

-- Stage 1's checks were intentionally NOT VALID while historical data was
-- under review. Once the above gate succeeds, validate them before allowing
-- new receipt writes to depend on the source marker.
ALTER TABLE "NasiyaPayment"
  VALIDATE CONSTRAINT "NasiyaPayment_input_snapshot_check";

ALTER TABLE "NasiyaPayment"
  VALIDATE CONSTRAINT "NasiyaPayment_exchange_rate_source_check";

CREATE OR REPLACE FUNCTION "validate_nasiya_parent_schedule_ledger"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_nasiya_id TEXT;
  parent_row "Nasiya"%ROWTYPE;
  schedule_count BIGINT;
  schedule_currency_mismatch BOOLEAN;
  schedule_expected NUMERIC;
  schedule_paid NUMERIC;
  schedule_remaining NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_nasiya_id := CASE
      WHEN TG_TABLE_NAME = 'Nasiya' THEN to_jsonb(OLD)->>'id'
      ELSE to_jsonb(OLD)->>'nasiyaId'
    END;
  ELSE
    target_nasiya_id := CASE
      WHEN TG_TABLE_NAME = 'Nasiya' THEN to_jsonb(NEW)->>'id'
      ELSE to_jsonb(NEW)->>'nasiyaId'
    END;
  END IF;

  SELECT * INTO parent_row
  FROM "Nasiya"
  WHERE id = target_nasiya_id;
  -- A parent hard-delete cascades schedules. At the deferred check point the
  -- parent has gone, so there is no live ledger left to validate.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(BOOL_OR(s."contractCurrency" <> parent_row."contractCurrency"), FALSE),
    COALESCE(SUM(s."contractExpectedAmount"), 0),
    COALESCE(SUM(s."contractPaidAmount"), 0),
    COALESCE(SUM(s."contractRemainingAmount"), 0)
  INTO schedule_count, schedule_currency_mismatch, schedule_expected, schedule_paid, schedule_remaining
  FROM "NasiyaSchedule" s
  WHERE s."nasiyaId" = target_nasiya_id;

  -- Every live contract must retain an authoritative schedule. If the
  -- parent is being deleted, the earlier parent lookup has already returned.
  IF schedule_count = 0 THEN
    RAISE EXCEPTION 'nasiya % has no authoritative schedules', target_nasiya_id;
  END IF;

  IF schedule_currency_mismatch THEN
    RAISE EXCEPTION 'nasiya % has schedule currency different from its immutable contract currency', target_nasiya_id;
  END IF;
  IF schedule_expected <> parent_row."contractFinalAmount" THEN
    RAISE EXCEPTION 'nasiya % schedule expected total does not equal financed total', target_nasiya_id;
  END IF;
  IF schedule_expected <> schedule_paid + schedule_remaining THEN
    RAISE EXCEPTION 'nasiya % schedule paid/remaining totals do not reconcile', target_nasiya_id;
  END IF;
  IF schedule_paid <> parent_row."contractPaidAmount"
    OR schedule_remaining <> parent_row."contractRemainingAmount" THEN
    RAISE EXCEPTION 'nasiya % parent paid/remaining cache differs from schedules', target_nasiya_id;
  END IF;
  -- A due date can turn a live contract overdue without any database write,
  -- so time-derived ACTIVE/OVERDUE is projected by `reconcileNasiyaLedger`.
  -- The durable terminal status is still safely enforceable at commit.
  IF parent_row.status <> 'CANCELLED'::"NasiyaStatus"
    AND (parent_row.status = 'COMPLETED'::"NasiyaStatus") <> (schedule_remaining = 0) THEN
    RAISE EXCEPTION 'nasiya % terminal status differs from its schedule balance', target_nasiya_id;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "Nasiya_parent_schedule_ledger_reconcile"
  AFTER INSERT OR UPDATE OR DELETE ON "Nasiya"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "validate_nasiya_parent_schedule_ledger"();

CREATE CONSTRAINT TRIGGER "NasiyaSchedule_parent_schedule_ledger_reconcile"
  AFTER INSERT OR UPDATE OR DELETE ON "NasiyaSchedule"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "validate_nasiya_parent_schedule_ledger"();
