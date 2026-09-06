import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const encode = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const format = encode(compile('../src/lib/format.ts'))
const drafts = await import(encode(compile('../src/lib/saleDrafts.ts').replace("'./format'", JSON.stringify(format))))
assert.equal(typeof drafts.writeWorkingSale, 'function', 'working draft persistence is available')
const memory = new Map()
globalThis.sessionStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key)
}
const input = { saleType: 'retail', lines: [{ variantId: 1, productName: 'Test', size: '40', color: '', qty: 2, unitPrice: 100 }], paidStr: '100', paidTouched: true, discountStr: '10', promise: '', bookPage: '12' }
drafts.writeWorkingSale(input)
assert.equal(drafts.readWorkingSale().lines[0].qty, 2, 'recovers unsaved quantities')
assert.equal(drafts.readWorkingSale().bookPage, '12', 'recovers debt book page')
drafts.writeWorkingSale({ ...input, lines: [] })
assert.equal(drafts.readWorkingSale(), null, 'empty cart is not recoverable')
drafts.writeWorkingSale(input, { id: 'held-1', createdAt: 1 })
assert.equal(drafts.readWorkingSale().id, 'held-1', 'held sale identity survives navigation')
drafts.clearWorkingSale()
assert.equal(drafts.readWorkingSale(), null, 'committed or discarded cart cannot be restored')
sessionStorage.setItem(drafts.WORKING_SALE_KEY, '{broken')
assert.equal(drafts.readWorkingSale(), null, 'corrupt storage does not crash sale creation')
drafts.writeWorkingSale(input)
sessionStorage.removeItem = () => { throw new Error('blocked') }
assert.throws(() => drafts.clearWorkingSale(), /blocked/)
assert.equal(drafts.readWorkingSale(), null, 'failed cleanup cannot restore a committed cart in this session')
sessionStorage.setItem = () => { throw new Error('quota') }
assert.throws(() => drafts.writeWorkingSale(input), /quota/, 'storage failures remain visible to caller')
console.log('PASS: working sale recovery, empty/discard/commit clearing, held identity, corruption, storage failure')
