import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const MODEL_FIELDS = {
  currencyRate: [
    'baseCurrency', 'quoteCurrency', 'source', 'effectiveDate',
    'providerReference', 'recordedById', 'recordedByType',
  ],
  shopPayment: [
    'currency', 'amountUzsSnapshot', 'amountUsdSnapshot',
    'exchangeRateAtPayment', 'exchangeRateSourceAtPayment',
    'exchangeRateEffectiveAtPayment', 'exchangeRateFetchedAtPayment',
    'idempotencyKey', 'commandHash', 'recordedById',
  ],
  device: [
    'purchaseCurrency', 'purchaseInputAmount', 'purchaseAmountUzsSnapshot',
    'purchaseExchangeRateAtCreation', 'purchaseExchangeRateSource',
    'purchaseExchangeRateEffectiveAt', 'purchaseExchangeRateFetchedAt', 'addedBy',
  ],
  devicePurchaseReceipt: [
    'inputAmount', 'inputCurrency', 'nativeAmount', 'nativeCurrency',
    'amountUzsSnapshot', 'exchangeRate', 'exchangeRateSource',
    'exchangeRateEffectiveAt', 'exchangeRateFetchedAt',
    'actorId', 'actorType', 'idempotencyKey', 'commandHash',
  ],
  sale: [
    'contractCurrency', 'contractSalePrice', 'creationCurrency',
    'creationExchangeRate', 'creationExchangeRateSource',
    'creationExchangeRateEffectiveAt', 'creationExchangeRateFetchedAt',
    'creationIdempotencyKey', 'creationCommandHash', 'createdBy',
  ],
  salePayment: [
    'paymentInputAmount', 'paymentInputCurrency',
    'appliedAmountInContractCurrency', 'paymentExchangeRate',
    'paymentExchangeRateSource', 'paymentExchangeRateEffectiveAt',
    'paymentExchangeRateFetchedAt', 'idempotencyKey', 'createdBy',
  ],
  supplierPayable: [
    'contractCurrency', 'contractAmount', 'contractExchangeRateAtCreation',
    'contractExchangeRateSourceAtCreation',
    'contractExchangeRateEffectiveAtCreation',
    'contractExchangeRateFetchedAtCreation',
    'creationIdempotencyKey', 'creationCommandHash', 'createdBy',
  ],
  supplierPayablePayment: [
    'paymentInputAmount', 'paymentInputCurrency',
    'appliedAmountInContractCurrency', 'paymentExchangeRate',
    'paymentExchangeRateSource', 'paymentExchangeRateEffectiveAt',
    'paymentExchangeRateFetchedAt', 'idempotencyKey', 'commandHash', 'createdBy',
  ],
  nasiya: [
    'contractCurrency', 'contractTotalAmount', 'creationCurrency',
    'creationExchangeRate', 'creationExchangeRateSource',
    'creationExchangeRateEffectiveAt', 'creationExchangeRateFetchedAt',
    'createdBy',
  ],
  nasiyaPayment: [
    'paymentInputAmount', 'paymentInputCurrency',
    'appliedAmountInContractCurrency', 'paymentExchangeRate',
    'paymentExchangeRateSource', 'paymentExchangeRateEffectiveAt',
    'paymentExchangeRateFetchedAt', 'idempotencyKey', 'createdBy',
  ],
} as const

type FinancialModel = keyof typeof MODEL_FIELDS

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : sourceFiles(path)
    }
    return /\.[tj]sx?$/.test(entry.name) ? [path] : []
  })
}

type Writer = {
  model: FinancialModel
  file: string
  line: number
  operation: string
  source: string
}

function financialWriters(): Writer[] {
  const writers: Writer[] = []
  for (const file of sourceFiles(join(process.cwd(), 'src'))) {
    const source = readFileSync(file, 'utf8')
    const parsed = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ['create', 'createMany', 'upsert'].includes(node.expression.name.text)
        && ts.isPropertyAccessExpression(node.expression.expression)
      ) {
        const model = node.expression.expression.name.text as FinancialModel
        if (model in MODEL_FIELDS) {
          writers.push({
            model,
            file: relative(process.cwd(), file),
            line: parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            operation: node.expression.name.text,
            source: node.getText(parsed),
          })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(parsed)
  }
  return writers
}

describe('financial writer inventory', () => {
  const writers = financialWriters()

  it('keeps the reviewed writer inventory explicit', () => {
    const inventory = Object.fromEntries(
      Object.keys(MODEL_FIELDS).map((model) => [
        model,
        writers
          .filter((writer) => writer.model === model)
          .map((writer) => `${writer.file}:${writer.operation}`)
          .sort(),
      ]),
    )

    expect(inventory).toEqual({
      currencyRate: [
        'src/app/api/admin/currency-rate/route.ts:create',
        'src/lib/server/currency.ts:create',
      ],
      shopPayment: ['src/app/api/shops/[id]/payment/route.ts:create'],
      device: [
        'src/app/api/devices/route.ts:create',
        'src/app/api/nasiya/import/route.ts:create',
        'src/app/api/olib-sotdim/route.ts:create',
      ],
      devicePurchaseReceipt: ['src/app/api/devices/route.ts:create'],
      sale: [
        'src/app/api/devices/[id]/sell/route.ts:create',
        'src/app/api/olib-sotdim/route.ts:create',
      ],
      salePayment: [
        'src/app/api/devices/[id]/sell/route.ts:create',
        'src/app/api/olib-sotdim/route.ts:create',
        'src/app/api/sales/[id]/payment/route.ts:create',
      ],
      supplierPayable: ['src/lib/server/supplier-payable-payments.ts:create'],
      supplierPayablePayment: [
        'src/lib/server/supplier-payable-payments.ts:create',
        'src/lib/server/supplier-payable-payments.ts:create',
      ],
      nasiya: [
        'src/app/api/nasiya/import/route.ts:create',
        'src/lib/server/nasiya-contract-core.ts:create',
      ],
      nasiyaPayment: [
        'src/app/api/nasiya/[id]/payment/route.ts:create',
        'src/app/api/nasiya/[id]/settlement/route.ts:create',
        'src/lib/server/nasiya-contract-core.ts:create',
      ],
    })
  })

  it.each(writers)('$model writer at $file:$line supplies complete v2 evidence', (writer) => {
    expect(writer.operation, `${writer.file}:${writer.line}`).toBe('create')
    expect(writer.source, `${writer.file}:${writer.line}`).toMatch(/\bevidenceVersion\s*:\s*2\b/)
    expect(writer.source, `${writer.file}:${writer.line}`).toMatch(/\bevidenceStatus\s*:/)
    for (const field of MODEL_FIELDS[writer.model]) {
      expect(writer.source, `${writer.file}:${writer.line} missing ${field}`).toMatch(
        new RegExp(`\\b${field}\\s*(?::|[,}])`),
      )
    }
  })

  it('has no raw-SQL bypass for reviewed financial inserts', () => {
    const rawSql = sourceFiles(join(process.cwd(), 'src'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')
    for (const model of [
      'CurrencyRate', 'ShopPayment', 'Device', 'DevicePurchaseReceipt',
      'Sale', 'SalePayment', 'SupplierPayable', 'SupplierPayablePayment',
      'Nasiya', 'NasiyaPayment',
    ]) {
      expect(rawSql).not.toContain(`INSERT INTO "${model}"`)
    }
  })
})
