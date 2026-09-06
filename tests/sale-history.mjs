import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const encode = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const format = encode(compile('../src/lib/format.ts'))
const { groupSaleHistory } = await import(encode(compile('../src/lib/saleHistory.ts').replace("'./format'", JSON.stringify(format))))
const sale = (id, date, total, overrides = {}) => ({ id, date: new Date(date).getTime(), total, paid: 0, lines: [{ productName: 'کفش', size: '42', color: 'سیاه' }], ...overrides })
const rows = [sale(1, '2026-09-05T23:59:59', 100), sale(2, '2026-09-06T00:00:00', 200), sale(3, '2026-09-06T12:00:00', 300, { customerName: 'احمد' }), sale(4, '2026-09-06T13:00:00', 500, { deleted: true }), sale(5, '2026-09-06T13:00:00', 500, { lenderAction: 'settlement' })]
const snapshot = JSON.stringify(rows)
const groups = groupSaleHistory(rows)
assert.deepEqual(groups.map(g => [g.sales.map(s => s.id), g.total]), [[[3, 2], 500], [[1], 100]])
assert.equal(groupSaleHistory(rows, '', '2026-09-05', '2026-09-05')[0].total, 100)
assert.equal(groupSaleHistory(rows, 'احمد کفش ۴۲')[0].total, 300)
assert.equal(groupSaleHistory(rows, 'مشتری نقدی')[0].total, 200)
assert.equal(groupSaleHistory(rows, '', '2026-09-07', '2026-09-05').length, 0)
assert.equal(groupSaleHistory(rows, 'ناموجود').length, 0)
assert.equal(groupSaleHistory(Array.from({ length: 150 }, (_, i) => sale(i, '2026-09-06T12:00:00', 1)))[0].total, 150)
assert.equal(JSON.stringify(rows), snapshot, 'grouping never changes stored records/order')
console.log('PASS: local-day boundaries, newest first, inclusive range, name/product/Persian-digit search, complete totals beyond 100, exclusions, no mutations')
