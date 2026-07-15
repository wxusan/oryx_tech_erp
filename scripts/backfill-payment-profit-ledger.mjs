import process from 'node:process'
import pg from 'pg'

const apply = process.argv.includes('--apply')
const retryGaps = process.argv.includes('--retry-gaps')
const shopArgument = process.argv.find((argument) => argument.startsWith('--shop-id='))
const shopId = shopArgument?.slice('--shop-id='.length) || null
const rawDatabaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!rawDatabaseUrl) throw new Error('DIRECT_URL or DATABASE_URL is required')

const databaseUrl = new URL(rawDatabaseUrl)
databaseUrl.searchParams.delete('schema')
const client = new pg.Client({ connectionString: databaseUrl.toString() })

const unit = (currency) => currency === 'USD' ? 100 : 1
const round = (value, currency) => currency === 'USD' ? Math.round(Number(value) * 100) / 100 : Math.round(Number(value))
const units = (value, currency) => Math.round(round(value, currency) * unit(currency))
const amount = (value, currency) => value / unit(currency)
const total = (values) => values.reduce((sum, value) => sum + value, 0)

function allocateByWeight(totalUnits, weights) {
  const weightTotal = total(weights)
  if (!weights.length || weightTotal <= 0) return weights.map(() => 0)
  let cumulative = 0
  let allocated = 0
  return weights.map((weight, index) => {
    cumulative += weight
    const target = index === weights.length - 1 ? totalUnits : Math.round(totalUnits * cumulative / weightTotal)
    const part = target - allocated
    allocated = target
    return part
  })
}

function componentPlan(nasiya, schedules, costBasis) {
  const currency = nasiya.contractCurrency
  const totalUnits = units(nasiya.contractTotalAmount, currency)
  const downUnits = units(nasiya.contractDownPayment, currency)
  const interestUnits = units(nasiya.contractInterestAmount, currency)
  const costUnits = units(costBasis, currency)
  const expected = schedules.map((row) => units(row.contractExpectedAmount, currency))
  if (totalUnits <= 0 || downUnits < 0 || downUnits > totalUnits || costUnits < 0) throw new Error('invalid component budget')
  if (total(expected) !== totalUnits - downUnits + interestUnits) throw new Error('schedule total does not reconcile')
  const interests = allocateByWeight(interestUnits, expected)
  const bases = expected.map((value, index) => value - interests[index])
  if (bases.some((value) => value < 0) || downUnits + total(bases) !== totalUnits) throw new Error('base schedule does not reconcile')
  const chunks = [downUnits, ...bases]
  const principals = allocateByWeight(costUnits, chunks)
  return {
    costBasis: amount(costUnits, currency),
    margin: amount(totalUnits - costUnits, currency),
    down: { principal: amount(principals[0], currency), margin: amount(chunks[0] - principals[0], currency), interest: 0 },
    schedules: schedules.map((row, index) => ({
      ...row,
      expected: amount(expected[index], currency),
      components: {
        principal: amount(principals[index + 1], currency),
        margin: amount(chunks[index + 1] - principals[index + 1], currency),
        interest: amount(interests[index], currency),
      },
    })),
  }
}

function cumulativeComponents(currency, componentTotals, componentPaid, paymentAmount) {
  const totals = Object.fromEntries(Object.entries(componentTotals).map(([key, value]) => [key, units(value, currency)]))
  const paid = Object.fromEntries(Object.entries(componentPaid).map(([key, value]) => [key, units(value, currency)]))
  const totalAmount = totals.principal + totals.margin + totals.interest
  const paidAmount = paid.principal + paid.margin + paid.interest
  const payment = units(paymentAmount, currency)
  const paidAfterAmount = paidAmount + payment
  if (totalAmount <= 0 || payment <= 0 || paidAfterAmount > totalAmount) throw new Error('payment exceeds component budget')
  const principal = paidAfterAmount === totalAmount ? totals.principal : Math.round(totals.principal * paidAfterAmount / totalAmount)
  const interest = paidAfterAmount === totalAmount ? totals.interest : Math.round(totals.interest * paidAfterAmount / totalAmount)
  const paidAfter = { principal, margin: paidAfterAmount - principal - interest, interest }
  return {
    allocation: Object.fromEntries(Object.keys(paidAfter).map((key) => [key, amount(paidAfter[key] - paid[key], currency)])),
    paidAfter: Object.fromEntries(Object.keys(paidAfter).map((key) => [key, amount(paidAfter[key], currency)])),
  }
}

function componentsAtPaidAmount(currency, componentTotals, paidAmount) {
  if (units(paidAmount, currency) === 0) return { principal: 0, margin: 0, interest: 0 }
  return cumulativeComponents(currency, componentTotals, { principal: 0, margin: 0, interest: 0 }, paidAmount).paidAfter
}

function reportingComponents(amountUzs, contractAmount, components) {
  const uzs = Math.round(Number(amountUzs))
  const native = Number(contractAmount)
  if (uzs <= 0 || native <= 0) throw new Error('invalid reporting amount')
  const principal = Math.round(uzs * components.principal / native)
  const interest = Math.round(uzs * components.interest / native)
  return { principal, margin: uzs - principal - interest, interest }
}

function deriveApplied(payment, currency) {
  if (payment.appliedAmountInContractCurrency != null && Number(payment.appliedAmountInContractCurrency) > 0) {
    return round(payment.appliedAmountInContractCurrency, currency)
  }
  if (currency === 'UZS') return round(payment.amount, 'UZS')
  if (payment.paymentInputCurrency === 'USD' && payment.paymentInputAmount != null) return round(payment.paymentInputAmount, 'USD')
  if (Number(payment.paymentExchangeRate) > 0) return round(Number(payment.amount) / Number(payment.paymentExchangeRate), 'USD')
  throw new Error(`payment ${payment.id} has no reliable native amount`)
}

function contractCost(contract, device) {
  const currency = contract.contractCurrency
  if (device.purchaseCurrency === currency) return round(device.purchaseInputAmount, currency)
  if (currency === 'UZS') return round(device.purchaseAmountUzsSnapshot, 'UZS')
  if (Number(contract.contractExchangeRateAtCreation) > 0) {
    return round(Number(device.purchaseAmountUzsSnapshot) / Number(contract.contractExchangeRateAtCreation), 'USD')
  }
  throw new Error('contract has no reliable cost-basis conversion')
}

function allocateUzs(amountUzs, nativeAmounts) {
  return allocateByWeight(Math.round(Number(amountUzs)), nativeAmounts.map((value) => Math.round(Number(value) * 100)))
}

async function updateSaleComponents(sale, plan, paidComponents, status, reason = null) {
  await client.query(`
    UPDATE "Sale" SET
      "contractCostBasisAmount" = $2,
      "contractMarginAmount" = $3,
      "contractPrincipalPaidAmount" = $4,
      "contractMarginPaidAmount" = $5,
      "accountingReconstructionStatus" = $6,
      "accountingReconstructionReason" = $7,
      "accountingReconstructedAt" = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [sale.id, plan.principal, plan.margin, paidComponents.principal, paidComponents.margin, status, reason])
}

async function reconstructSale(sale) {
  const currency = sale.contractCurrency
  const cost = contractCost(sale, sale.device)
  const plan = { principal: cost, margin: round(Number(sale.contractSalePrice) - cost, currency), interest: 0 }
  const aggregatePaid = componentsAtPaidAmount(currency, plan, Number(sale.contractAmountPaid))
  const paymentUpdates = []
  let paid = { principal: 0, margin: 0, interest: 0 }
  try {
    for (const payment of sale.payments) {
      const applied = deriveApplied(payment, currency)
      const result = cumulativeComponents(currency, plan, paid, applied)
      const reporting = reportingComponents(payment.amount, applied, result.allocation)
      paymentUpdates.push({ payment, applied, ...result, reporting })
      paid = result.paidAfter
    }
    if (units(paid.principal + paid.margin, currency) !== units(sale.contractAmountPaid, currency)) {
      throw new Error('active payment rows do not reconcile with sale paid total')
    }
  } catch (error) {
    await updateSaleComponents(sale, plan, aggregatePaid, 'PARTIAL', String(error.message).slice(0, 500))
    return { status: 'PARTIAL', reversals: [] }
  }

  for (const row of paymentUpdates) {
    await client.query(`
      UPDATE "SalePayment" SET
        "contractPrincipalAmount" = $2,
        "contractMarginAmount" = $3,
        "principalAmountUzs" = $4,
        "marginAmountUzs" = $5
      WHERE id = $1
    `, [row.payment.id, row.allocation.principal, row.allocation.margin, row.reporting.principal, row.reporting.margin])
  }
  await updateSaleComponents(sale, plan, paid, 'COMPLETE')

  return {
    status: 'COMPLETE',
    reversals: sale.returns.map((returned) => ({
      deviceReturnId: returned.id,
      saleId: sale.id,
      nasiyaId: null,
      margin: paymentUpdates.filter((row) => row.payment.paidAt <= returned.createdAt).reduce((sum, row) => sum + row.reporting.margin, 0),
      interest: 0,
      createdAt: returned.createdAt,
    })),
  }
}

async function applyNasiyaPlan(nasiya, plan, schedulePaid, status, reason = null) {
  await client.query(`
    UPDATE "Nasiya" SET
      "contractCostBasisAmount" = $2,
      "contractMarginAmount" = $3,
      "contractDownPaymentPrincipalAmount" = $4,
      "contractDownPaymentMarginAmount" = $5,
      "accountingReconstructionStatus" = $6,
      "accountingReconstructionReason" = $7,
      "accountingReconstructedAt" = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [nasiya.id, plan.costBasis, plan.margin, plan.down.principal, plan.down.margin, status, reason])
  for (const schedule of plan.schedules) {
    const paid = schedulePaid.get(schedule.id)
    await client.query(`
      UPDATE "NasiyaSchedule" SET
        "contractPrincipalAmount" = $2,
        "contractMarginAmount" = $3,
        "contractInterestAmount" = $4,
        "contractPrincipalPaidAmount" = $5,
        "contractMarginPaidAmount" = $6,
        "contractInterestPaidAmount" = $7
      WHERE id = $1
    `, [schedule.id, schedule.components.principal, schedule.components.margin, schedule.components.interest, paid.principal, paid.margin, paid.interest])
  }
}

async function reconstructNasiya(nasiya) {
  if (nasiya.isImported) throw new Error('pre-Oryx import has no reliable historic margin/cost split')
  const currency = nasiya.contractCurrency
  const plan = componentPlan(nasiya, nasiya.schedules, contractCost(nasiya, nasiya.device))
  const schedulePaid = new Map(plan.schedules.map((schedule) => [
    schedule.id,
    componentsAtPaidAmount(currency, schedule.components, Number(schedule.contractPaidAmount)),
  ]))
  const replayPaid = new Map(plan.schedules.map((schedule) => [schedule.id, { principal: 0, margin: 0, interest: 0 }]))
  const replayAmounts = new Map(plan.schedules.map((schedule) => [schedule.id, 0]))
  const allocationRows = []

  try {
    for (const payment of nasiya.payments) {
      const applied = deriveApplied(payment, currency)
      const isDownPayment = payment.nasiyaScheduleId == null
        && payment.note === "Boshlang'ich to'lov"
        && units(applied, currency) === units(nasiya.contractDownPayment, currency)
      if (isDownPayment) {
        const reporting = reportingComponents(payment.amount, applied, plan.down)
        allocationRows.push({ payment, scheduleId: null, contractAmount: applied, components: plan.down, reporting, amountUzs: Math.round(payment.amount), sequence: 1 })
        continue
      }
      if (!payment.nasiyaScheduleId) throw new Error(`payment ${payment.id} has no reconstructable selected schedule`)
      const selected = plan.schedules.find((schedule) => schedule.id === payment.nasiyaScheduleId)
      if (!selected) throw new Error(`payment ${payment.id} references a missing schedule`)
      const ordered = [selected, ...plan.schedules
        .filter((schedule) => schedule.id !== selected.id)
        .sort((left, right) => new Date(left.delayedUntil ?? left.dueDate) - new Date(right.delayedUntil ?? right.dueDate) || left.monthNumber - right.monthNumber)]
      let remaining = units(applied, currency)
      const nativeParts = []
      for (const schedule of ordered) {
        if (remaining <= 0) break
        const expectedUnits = units(schedule.expected, currency)
        const paidUnits = units(replayAmounts.get(schedule.id), currency)
        const partUnits = Math.min(remaining, expectedUnits - paidUnits)
        if (partUnits <= 0) continue
        nativeParts.push({ schedule, contractAmount: amount(partUnits, currency) })
        remaining -= partUnits
      }
      if (remaining !== 0) throw new Error(`payment ${payment.id} exceeds replayed debt`)
      const uzsParts = allocateUzs(payment.amount, nativeParts.map((part) => part.contractAmount))
      for (const [index, part] of nativeParts.entries()) {
        const paidBefore = replayPaid.get(part.schedule.id)
        const result = cumulativeComponents(currency, part.schedule.components, paidBefore, part.contractAmount)
        const reporting = reportingComponents(uzsParts[index], part.contractAmount, result.allocation)
        replayPaid.set(part.schedule.id, result.paidAfter)
        replayAmounts.set(part.schedule.id, round(replayAmounts.get(part.schedule.id) + part.contractAmount, currency))
        allocationRows.push({
          payment,
          scheduleId: part.schedule.id,
          contractAmount: part.contractAmount,
          components: result.allocation,
          reporting,
          amountUzs: uzsParts[index],
          sequence: index + 1,
        })
      }
    }
    for (const schedule of plan.schedules) {
      if (units(replayAmounts.get(schedule.id), currency) !== units(schedule.contractPaidAmount, currency)) {
        throw new Error(`schedule ${schedule.id} payment replay does not reconcile`)
      }
    }
  } catch (error) {
    await applyNasiyaPlan(nasiya, plan, schedulePaid, 'PARTIAL', String(error.message).slice(0, 500))
    return { status: 'PARTIAL', reversals: [] }
  }

  await applyNasiyaPlan(nasiya, plan, replayPaid, 'COMPLETE')
  for (const row of allocationRows) {
    await client.query(`
      INSERT INTO "NasiyaPaymentAllocation" (
        id, "shopId", "nasiyaId", "nasiyaPaymentId", "nasiyaScheduleId", sequence,
        "contractCurrency", "contractAmount", "contractPrincipalAmount", "contractMarginAmount",
        "contractInterestAmount", "amountUzs", "principalAmountUzs", "marginAmountUzs",
        "interestAmountUzs", "createdAt"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    `, [
      `backfill:${row.payment.id}:${row.sequence}`,
      nasiya.shopId,
      nasiya.id,
      row.payment.id,
      row.scheduleId,
      row.sequence,
      currency,
      row.contractAmount,
      row.components.principal,
      row.components.margin,
      row.components.interest,
      row.amountUzs,
      row.reporting.principal,
      row.reporting.margin,
      row.reporting.interest,
      row.payment.createdAt,
    ])
  }
  return {
    status: 'COMPLETE',
    reversals: nasiya.returns.map((returned) => {
      const recognized = allocationRows.filter((row) => row.payment.paidAt <= returned.createdAt)
      return {
        deviceReturnId: returned.id,
        saleId: null,
        nasiyaId: nasiya.id,
        margin: recognized.reduce((sum, row) => sum + row.reporting.margin, 0),
        interest: recognized.reduce((sum, row) => sum + row.reporting.interest, 0),
        createdAt: returned.createdAt,
      }
    }),
  }
}

async function insertReversals(shopId, reversals) {
  for (const reversal of reversals) {
    await client.query(`
      INSERT INTO "ReturnProfitReversal" (
        id, "shopId", "deviceReturnId", "saleId", "nasiyaId",
        "recognizedMarginAmountUzs", "recognizedInterestAmountUzs", "createdAt"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT ("deviceReturnId") DO NOTHING
    `, [
      `backfill:return:${reversal.deviceReturnId}`,
      shopId,
      reversal.deviceReturnId,
      reversal.saleId,
      reversal.nasiyaId,
      reversal.margin,
      reversal.interest,
      reversal.createdAt,
    ])
  }
}

const summary = {
  mode: apply ? 'apply' : 'dry-run',
  retryGaps,
  shopId,
  sales: { complete: 0, partial: 0, unreconstructable: 0 },
  nasiyas: { complete: 0, partial: 0, unreconstructable: 0 },
  returnReversals: 0,
}

await client.connect()
try {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE')
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('oryx:payment-profit-backfill'))`)
  const migration = await client.query(`
    SELECT 1 FROM "_prisma_migrations"
    WHERE migration_name = '202607150003_monthly_profit_recognition'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  `)
  if (!migration.rowCount) throw new Error('monthly profit recognition migration is not applied')

  const filter = shopId ? 'AND s."shopId" = $1' : ''
  const reconstructionFilter = retryGaps
    ? '"accountingReconstructionStatus" <> \'COMPLETE\''
    : '"accountingReconstructionStatus" = \'PENDING\''
  const params = shopId ? [shopId] : []
  const sales = await client.query(`
    SELECT s.*, row_to_json(d.*) AS device,
      COALESCE((SELECT json_agg(p ORDER BY p."paidAt", p."createdAt", p.id) FROM "SalePayment" p WHERE p."saleId" = s.id AND p."deletedAt" IS NULL), '[]') AS payments,
      COALESCE((SELECT json_agg(r ORDER BY r."createdAt", r.id) FROM "DeviceReturn" r WHERE r."saleId" = s.id), '[]') AS returns
    FROM "Sale" s JOIN "Device" d ON d.id = s."deviceId" AND d."shopId" = s."shopId"
    WHERE s.${reconstructionFilter} ${filter}
    ORDER BY s."shopId", s."createdAt", s.id
  `, params)
  for (const sale of sales.rows) {
    try {
      const result = await reconstructSale(sale)
      summary.sales[result.status === 'COMPLETE' ? 'complete' : 'partial'] += 1
      await insertReversals(sale.shopId, result.reversals)
      summary.returnReversals += result.reversals.length
    } catch (error) {
      summary.sales.unreconstructable += 1
      await client.query(`UPDATE "Sale" SET "accountingReconstructionStatus" = 'UNRECONSTRUCTABLE', "accountingReconstructionReason" = $2, "accountingReconstructedAt" = CURRENT_TIMESTAMP WHERE id = $1`, [sale.id, String(error.message).slice(0, 500)])
    }
  }

  const nasiyaFilter = shopId ? 'AND n."shopId" = $1' : ''
  const nasiyas = await client.query(`
    SELECT n.*, row_to_json(d.*) AS device,
      COALESCE((SELECT json_agg(s ORDER BY s."monthNumber", s.id) FROM "NasiyaSchedule" s WHERE s."nasiyaId" = n.id), '[]') AS schedules,
      COALESCE((SELECT json_agg(p ORDER BY p."paidAt", p."createdAt", p.id) FROM "NasiyaPayment" p WHERE p."nasiyaId" = n.id AND p."deletedAt" IS NULL), '[]') AS payments,
      COALESCE((SELECT json_agg(r ORDER BY r."createdAt", r.id) FROM "DeviceReturn" r WHERE r."nasiyaId" = n.id), '[]') AS returns
    FROM "Nasiya" n JOIN "Device" d ON d.id = n."deviceId" AND d."shopId" = n."shopId"
    WHERE n.${reconstructionFilter} ${nasiyaFilter}
    ORDER BY n."shopId", n."createdAt", n.id
  `, params)
  for (const nasiya of nasiyas.rows) {
    try {
      const result = await reconstructNasiya(nasiya)
      summary.nasiyas[result.status === 'COMPLETE' ? 'complete' : 'partial'] += 1
      await insertReversals(nasiya.shopId, result.reversals)
      summary.returnReversals += result.reversals.length
    } catch (error) {
      summary.nasiyas.unreconstructable += 1
      await client.query(`UPDATE "Nasiya" SET "accountingReconstructionStatus" = 'UNRECONSTRUCTABLE', "accountingReconstructionReason" = $2, "accountingReconstructedAt" = CURRENT_TIMESTAMP WHERE id = $1`, [nasiya.id, String(error.message).slice(0, 500)])
    }
  }

  if (apply) await client.query('COMMIT')
  else await client.query('ROLLBACK')
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  throw error
} finally {
  await client.end()
}
