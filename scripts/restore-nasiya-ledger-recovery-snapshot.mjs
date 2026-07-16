/** Restore a PNG-enveloped guarded Nasiya recovery snapshot to its gzip file. */

import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const input = process.argv.find((argument) => argument.startsWith('--input='))?.slice('--input='.length)
const output = process.argv.find((argument) => argument.startsWith('--output='))?.slice('--output='.length)

if (!input || !output) throw new Error('--input=<archive.png> and --output=<snapshot.json.gz> are required')

const { data, info } = await sharp(readFileSync(input)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
if (info.channels !== 4 || data.length < 8) throw new Error('Recovery archive is not a PNG RGBA envelope')

const payloadLength = Number(data.readBigUInt64BE(0))
if (!Number.isSafeInteger(payloadLength) || payloadLength < 1 || payloadLength > data.length - 8) {
  throw new Error('Recovery archive payload length is invalid')
}

writeFileSync(output, data.subarray(8, 8 + payloadLength), { mode: 0o600 })
console.log(JSON.stringify({ restored: true, bytes: payloadLength }))
