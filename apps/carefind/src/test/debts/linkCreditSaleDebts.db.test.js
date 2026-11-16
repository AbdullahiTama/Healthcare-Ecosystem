// @vitest-environment node
// carehub_20270121_link_credit_sale_debts (CODE_AUDIT A32) on PGlite, over carehub_20270117 (debtsFixture): a
// credit-sale debt without a client gets its sale's client only when the reference is unambiguous, the sale has a
// client and the client is the same business's; nothing else on the debt changes; running it again links nothing.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BIZ, OTHER, C, read, createDebtsDb } from './debtsFixture'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const FIX = read('carehub_20270121_link_credit_sale_debts.sql')
const id = (n) => 'e1000000-0000-4000-8000-00000000000' + n

let db
const q = async (sql) => (await db.query(sql)).rows
beforeEach(async () => {
  db = await createDebtsDb()
  await db.exec(`
    insert into clients (id, business_id, full_name, phone) values ('${C(8)}', '${OTHER}', 'Other biz client', '0900 000 0000');
    insert into sales (business_id, txn_no, client_name, client_id, total, amount_paid, balance, is_credit, status) values
      ('${BIZ}', 'T-LINK', 'Ada Obi', '${C(1)}', 17800, 0, 17800, true, null),
      ('${BIZ}', 'T-PAID', 'Ada Obi', '${C(1)}', 5000, 5000, 0, false, null),
      ('${BIZ}', 'T-WALK', 'Walk-in', null, 900, 0, 900, true, null),
      ('${BIZ}', 'T-DUP', 'Ada Obi', '${C(1)}', 100, 0, 100, true, null),
      ('${BIZ}', 'T-DUP', 'Ben', '${C(2)}', 100, 0, 100, true, null),
      ('${BIZ}', 'T-XBIZ', 'Other', '${C(8)}', 100, 0, 100, true, null);
    insert into debts (id, business_id, direction, party_name, amount, amount_paid, balance, status, source, source_ref, client_id) values
      ('${id(1)}', '${BIZ}', 'owes_us', 'Ada Obi (old spelling)', 17800, 0, 17800, 'pending', 'credit_sale', 'T-LINK', null),
      ('${id(2)}', '${BIZ}', 'owes_us', 'Ada Obi', 5000, 5000, 0, 'paid', 'credit_sale', 'T-PAID', null),
      ('${id(3)}', '${BIZ}', 'owes_us', 'Walk-in · T-WALK', 900, 0, 900, 'pending', 'credit_sale', 'T-WALK', null),
      ('${id(4)}', '${BIZ}', 'owes_us', 'Ada Obi', 100, 0, 100, 'pending', 'credit_sale', 'T-DUP', null),
      ('${id(5)}', '${BIZ}', 'owes_us', 'Other', 100, 0, 100, 'pending', 'credit_sale', 'T-XBIZ', null),
      ('${id(6)}', '${BIZ}', 'owes_us', 'Musa', 3200, 0, 3200, 'pending', 'credit_sale', 'T-NOSALE', null);
  `)
})

describe('carehub_20270121_link_credit_sale_debts', () => {
  it('links only unambiguous references whose sale has a client of the same business', async () => {
    const before = await q(`select id, party_name, amount::float8 a, amount_paid::float8 p, balance::float8 b, status, source, source_ref from debts order by id`)
    await db.exec(FIX)
    const linked = await q(`select id, client_id from debts where id in ('${id(1)}','${id(2)}','${id(3)}','${id(4)}','${id(5)}','${id(6)}') order by id`)
    expect(linked).toEqual([
      { id: id(1), client_id: C(1) }, // open, linked
      { id: id(2), client_id: C(1) }, // paid, linked
      { id: id(3), client_id: null }, // walk-in sale: no client
      { id: id(4), client_id: null }, // two sales share the reference: never guessed
      { id: id(5), client_id: null }, // the sale's client belongs to another business
      { id: id(6), client_id: null }, // no sale with that reference
    ])
    // Nothing else on any debt changed (party_name stays as recorded).
    expect(await q(`select id, party_name, amount::float8 a, amount_paid::float8 p, balance::float8 b, status, source, source_ref from debts order by id`)).toEqual(before)
  })

  it('leaves existing links alone and links nothing more when run again', async () => {
    await db.exec(FIX)
    const after = await q(`select id, client_id from debts order by id`)
    await db.exec(FIX)
    expect(await q(`select id, client_id from debts order by id`)).toEqual(after)
  })
})
