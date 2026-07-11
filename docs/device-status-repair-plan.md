# Device status repair plan

No production data is changed automatically by the `SOLD_DEBT` migration.

Before a separately approved maintenance run, export and review these candidates:

```sql
-- Legacy returned inventory that business confirms is physically sellable.
SELECT id, "shopId", model, imei, "updatedAt"
FROM "Device"
WHERE status = 'RETURNED'::"DeviceStatus" AND "deletedAt" IS NULL;

-- Old simple sales that were stored as SOLD_CASH despite an open native debt.
SELECT d.id, d."shopId", d.model, s.id AS "saleId", s."contractRemainingAmount"
FROM "Device" d
JOIN "Sale" s ON s."deviceId" = d.id
WHERE d.status = 'SOLD_CASH'::"DeviceStatus"
  AND d."deletedAt" IS NULL
  AND s."deletedAt" IS NULL
  AND s."contractRemainingAmount" > 0;
```

For each row, verify the physical inventory and contract balance, export a backup,
then update only the approved IDs in a transaction. Keep the approved ID list and
before/after status values for rollback. Do not alter sales, payments, nasiya rows,
or return history during this repair.
