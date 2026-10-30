// Stock counts on the stock ledger (carehub_20261226_stock_count_ledger): a count applies each
// line's adjustment to the stock as it is now, through apply_stock_change, so a sale made while the
// count was open is kept; refusals are whole-count; a retried save adjusts once.
// The live pre-ledger function runs first, so the upgrade (and the bug it fixes) is real.
// See _harness.mjs for scope and limits.
//   node scripts/db-tests/stockCount.pglite.mjs
import fs from 'node:fs'
import { ok, finish, as, sup, db, applyMigrations, expectError, seedStaff, USERS, REPO } from './_harness.mjs'

// ---- live-shaped stand-ins (read 2026-10-30) ----------------------------------------------------
await db.exec(`
  CREATE TABLE public.products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, name text NOT NULL, stock integer DEFAULT 0,
    price numeric DEFAULT 0, category text, tracking_mode text NOT NULL DEFAULT 'none');
  CREATE TABLE public.stock_batches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, product_id uuid, product_name text NOT NULL,
    batch_number text, quantity integer NOT NULL DEFAULT 0, expiry_date date, status text NOT NULL DEFAULT 'available', created_at timestamptz DEFAULT now());
  CREATE TABLE public.stock_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, batch_id uuid, from_location_id uuid,
    to_location_id uuid, movement_type text NOT NULL, quantity integer NOT NULL, reason text, moved_by text, created_at timestamptz DEFAULT now(),
    product_id uuid, source_type text, source_id text, source_line_id text, idempotency_key text, actor_id uuid, qty_before integer, qty_after integer,
    CONSTRAINT stock_movements_type_check CHECK (movement_type = ANY (ARRAY['opening','purchase_receipt','sale','sale_reversal','return_restock',
      'return_writeoff','adjustment','write_off','transfer','tracking_change','correction'])));
  CREATE UNIQUE INDEX stock_movements_idem_uniq ON public.stock_movements (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  CREATE TABLE public.stock_validation_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, user_id uuid, user_name text,
    products_checked integer DEFAULT 0, products_adjusted integer DEFAULT 0, status text DEFAULT 'completed', created_at timestamptz DEFAULT now());
  CREATE TABLE public.stock_validation_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid, product_id uuid, product_name text,
    shelf_label text, previous_stock integer DEFAULT 0, adjustment_qty integer DEFAULT 0, adjustment_direction text, new_stock integer DEFAULT 0,
    reason text, unit_price numeric DEFAULT 0, created_at timestamptz DEFAULT now());
  ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.stock_batches ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.stock_validation_sessions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.stock_validation_items ENABLE ROW LEVEL SECURITY;
  CREATE POLICY own ON public.products TO authenticated USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin()) WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  CREATE POLICY own ON public.stock_batches TO authenticated USING (business_id IN (SELECT current_business_ids())) WITH CHECK (business_id IN (SELECT current_business_ids()));
  CREATE POLICY own ON public.stock_movements TO authenticated USING (business_id IN (SELECT current_business_ids())) WITH CHECK (business_id IN (SELECT current_business_ids()));
  CREATE POLICY "stock_validation_sessions of own business" ON public.stock_validation_sessions
    USING ((business_id IN (SELECT current_business_ids())) OR is_platform_admin()) WITH CHECK ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());
  CREATE POLICY "stock_validation_items via parent session" ON public.stock_validation_items
    USING (is_platform_admin() OR session_id IN (SELECT id FROM stock_validation_sessions WHERE business_id IN (SELECT current_business_ids())))
    WITH CHECK (is_platform_admin() OR session_id IN (SELECT id FROM stock_validation_sessions WHERE business_id IN (SELECT current_business_ids())));
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.products, public.stock_batches, public.stock_validation_sessions, public.stock_validation_items TO anon, authenticated;
  GRANT SELECT, INSERT ON public.stock_movements TO authenticated;
`)
await db.exec(fs.readFileSync(REPO + '/docs/architecture/stock-ledger-live-snapshot.sql', 'utf8'))
await db.exec(`
  CREATE TRIGGER enforce_product_stock_floor BEFORE INSERT OR UPDATE OF stock ON public.products FOR EACH ROW EXECUTE FUNCTION enforce_product_stock_floor();
  CREATE TRIGGER enforce_batch_quantity_floor BEFORE INSERT OR UPDATE OF quantity ON public.stock_batches FOR EACH ROW EXECUTE FUNCTION enforce_batch_quantity_floor();
`)
await db.exec(fs.readFileSync(REPO + '/docs/architecture/stock-count-pre-ledger-snapshot.sql', 'utf8'))
const live = (await sup(`select md5(prosrc) m from pg_proc where proname = 'save_stock_validation_session'`)).rows[0].m
ok('the pre-ledger snapshot is the live code byte for byte', live === '03cf6395985d4ee3344ab39d0fa4c21c', live)

const S = await seedStaff()
const product = async (name, stock, extra = {}) => (await sup(
  `insert into products (business_id, name, stock, price, category, tracking_mode) values ($1,$2,$3,100,$4,$5) returning id`,
  [extra.biz || S.A, name, stock, extra.category || 'Medicines', extra.mode || 'none'])).rows[0].id
const stock = async (id) => (await sup('select stock from products where id=$1', [id])).rows[0].stock
const sell = (id, n) => sup('update products set stock = stock - $2 where id = $1', [id, n])   // a till sale, as far as stock is concerned
// What the screen sends: the stock it showed, the typed adjustment, and the "New Stock" it previewed.
const line = (id, name, seen, qty, dir = '+', reason = 'Physical stock discrepancy') =>
  ({ product_id: id, product_name: name, shelf_label: null, previous_stock: seen, adjustment_qty: qty, adjustment_direction: dir,
     new_stock: dir === '-' ? seen - qty : seen + qty, reason, unit_price: 100 })
const save = (who, items, key, biz = S.A) => as(who,
  `select public.save_stock_validation_session($1, null, 'Rep One', $2, $2, $3::jsonb, $4) id`,
  [biz, items.length, JSON.stringify(items), key]).then((r) => r.rows[0].id)
// The call an older screen makes: six arguments, no key.
const saveLegacy = (who, items, biz = S.A) => as(who,
  `select public.save_stock_validation_session($1, null, 'Rep One', $2, $2, $3::jsonb) id`,
  [biz, items.length, JSON.stringify(items)]).then((r) => r.rows[0].id)
const sessions = async () => (await sup('select count(*)::int c from stock_validation_sessions')).rows[0].c
const moves = async (session) => (await sup(`select * from stock_movements where source_type = 'stock_count' and source_id = $1 order by quantity`, [session])).rows

// ---- before: the live function ---------------------------------------------------------------------
const before = await product('Before', 10)
await sell(before, 1)                                   // the screen still shows 10
await saveLegacy('repA1', [line(before, 'Before', 10, 3, '-')])
ok('BEFORE: a sale made while the count was open was overwritten (9 - 3 saved as 7)', (await stock(before)) === 7)

await applyMigrations(['carehub_20261226_stock_count_ledger.sql'])

// ---- after ---------------------------------------------------------------------------------------
const amox = await product('Amoxil', 10)
await sell(amox, 1)
const s1 = await save('repA1', [line(amox, 'Amoxil', 10, 3, '-')], 'count-1')
let m = await moves(s1)
const item1 = (await sup('select * from stock_validation_items where session_id = $1', [s1])).rows[0]
ok('the adjustment is applied to the stock as it is now: 9 - 3 = 6, the sale is kept', (await stock(amox)) === 6)
ok('one adjustment row naming the count, its line and who counted', m.length === 1 && m[0].movement_type === 'adjustment' && m[0].quantity === -3
  && m[0].qty_before === 9 && m[0].qty_after === 6 && m[0].source_line_id === item1.id && m[0].idempotency_key === `stock_count:${s1}:${item1.id}`
  && m[0].moved_by === USERS.repA1.email && m[0].actor_id === USERS.repA1.sub, JSON.stringify(m))
ok('the reason says what the screen showed when the stock had moved', m[0].reason === 'Stock count: Physical stock discrepancy (screen showed 10, stock was 9)', m[0].reason)
ok('the history line records the real before and after', item1.previous_stock === 9 && item1.new_stock === 6 && item1.adjustment_qty === 3 && item1.adjustment_direction === '-')

const again = await save('repA1', [line(amox, 'Amoxil', 10, 3, '-')], 'count-1')
ok('the same count saved again (lost reply, second tap) returns the first session and adjusts once', again === s1 && (await stock(amox)) === 6 && (await sessions()) === 2)

const neg = await product('Oversold', 0)
await db.exec(`alter table products disable trigger enforce_product_stock_floor;
  update products set stock = -5 where id = '${neg}';
  alter table products enable trigger enforce_product_stock_floor;`)
await save('repA1', [line(neg, 'Oversold', -5, 8, '+')], 'count-neg')
ok('a negative stock shown honestly: -5, Add 8 gives 3', (await stock(neg)) === 3)

const panadol = await product('Panadol', 2)
const zinc = await product('Zinc', 5)
const nBefore = await sessions()
await expectError('removing more than is in stock now refuses the whole count, naming the product',
  () => save('repA1', [line(zinc, 'Zinc', 5, 1, '+'), line(panadol, 'Panadol', 2, 5, '-')], 'count-short'),
  'INSUFFICIENT_STOCK: Panadol has 2 in stock now, so 5 cannot be removed.')
ok('and nothing of it is kept: no session, Zinc not added either', (await sessions()) === nBefore && (await stock(zinc)) === 5 && (await stock(panadol)) === 2)

const steady = await product('Steady', 4)
const s3 = await save('repA1', [line(steady, 'Steady', 4, 0, '+')], 'count-zero')
ok('a line with nothing to adjust is recorded with no ledger row', (await moves(s3)).length === 0
  && (await sup('select previous_stock, new_stock from stock_validation_items where session_id=$1', [s3])).rows[0].new_stock === 4)

const tracked = await product('Insulin', 6, { mode: 'batch_expiry' })
await expectError('a batch-tracked product cannot be adjusted from a count (no batch field)',
  () => save('repA1', [line(tracked, 'Insulin', 6, 1, '-')], 'count-tracked'), 'BATCH_REQUIRED: Insulin is tracked by batch')

const other = await product('Company B stock', 9, { biz: S.B })
await expectError('another business\'s product in a count is refused and untouched',
  () => save('repA1', [line(other, 'Company B stock', 9, 4, '-')], 'count-other'), 'PRODUCT_NOT_FOUND')
ok('the other business\'s stock is unchanged', (await stock(other)) === 9)
await expectError('a count cannot be saved into another business', () => save('repB1', [line(amox, 'Amoxil', 6, 1, '+')], 'count-b', S.A), 'row-level security')
ok('so Company A\'s stock is unchanged', (await stock(amox)) === 6)

const svc = await product('Consultation', 999, { category: 'Services' })
await save('repA1', [line(svc, 'Consultation', 999, 5, '-')], 'count-svc')
ok('a service is recorded but its stock is not changed', (await stock(svc)) === 999)

await expectError('a quantity that is not a whole number is refused', () => save('repA1', [{ ...line(amox, 'Amoxil', 6, 1), adjustment_qty: '2.5' }], 'count-bad'), 'COUNT_INVALID')

const legacy = await saveLegacy('repA1', [line(amox, 'Amoxil', 6, 2, '+')])
ok('an older screen (six arguments, no key) still saves', !!legacy && (await stock(amox)) === 8)

// ---- who can call it -------------------------------------------------------------------------------
const can = async (role) => (await sup(`select has_function_privilege($1, 'public.save_stock_validation_session(uuid, uuid, text, integer, integer, jsonb, text)', 'EXECUTE') x`, [role])).rows[0].x
ok('signed-in users can save a count; visitors cannot call it', (await can('authenticated')) && !(await can('anon')))
const cfg = (await sup(`select prosecdef, proconfig from pg_proc where proname = 'save_stock_validation_session'`)).rows
ok('one function only, SECURITY INVOKER (RLS stays the boundary), pinned search_path', cfg.length === 1 && cfg[0].prosecdef === false
  && String(cfg[0].proconfig).includes('search_path=public, pg_temp'), JSON.stringify(cfg))

// ---- carehub_20261227: the history is written only by the function ---------------------------------
const histBefore = await sessions()
let directInsert = null
try { await as('repA1', `insert into stock_validation_sessions (business_id, user_name) values ($1, 'forged')`, [S.A]) } catch (e) { directInsert = e.message }
ok('BEFORE the lock: a member could write count history directly', directInsert === null && (await sessions()) === histBefore + 1, directInsert)

await applyMigrations(['carehub_20261227_lock_stock_count_history.sql'])

const writeRefused = async (sql, params) => { try { await as('repA1', sql, params); return false } catch (e) { return /permission denied/.test(e.message) } }
ok('a member can no longer insert, edit or delete count history directly',
  await writeRefused(`insert into stock_validation_sessions (business_id, user_name) values ($1, 'forged')`, [S.A])
  && await writeRefused(`update stock_validation_items set new_stock = 999 where session_id = $1`, [s1])
  && await writeRefused(`delete from stock_validation_sessions where id = $1`, [s1])
  && await writeRefused(`delete from stock_validation_items where session_id = $1`, [s1]))
ok('and the history is intact', (await sup('select new_stock from stock_validation_items where session_id = $1', [s1])).rows[0].new_stock === 6)
ok('members still read their own history; another business sees none of it',
  (await as('repA1', 'select count(*)::int c from stock_validation_sessions where id = $1', [s1])).rows[0].c === 1
  && (await as('repA1', 'select count(*)::int c from stock_validation_items where session_id = $1', [s1])).rows[0].c === 1
  && (await as('repB1', 'select count(*)::int c from stock_validation_sessions where id = $1', [s1])).rows[0].c === 0)
const anonPriv = (await sup(`select count(*)::int c from information_schema.role_table_grants where grantee = 'anon' and table_name in ('stock_validation_sessions', 'stock_validation_items')`)).rows[0].c
ok('visitors hold no privilege on either table', anonPriv === 0, anonPriv)

const lockA = await product('After lock', 10)
const s4 = await as('repA1', `select public.save_stock_validation_session($1, $2, 'Forged name', 1, 1, $3::jsonb, 'count-locked') id`,
  [S.A, USERS.repB1.sub, JSON.stringify([line(lockA, 'After lock', 10, 2, '-')])]).then((r) => r.rows[0].id)
const s4row = (await sup('select user_id, user_name from stock_validation_sessions where id = $1', [s4])).rows[0]
ok('saving a count still works for a member, through the ledger', (await stock(lockA)) === 8 && (await moves(s4)).length === 1)
ok('who counted comes from the login, not the screen (sent another user id and "Forged name")', s4row.user_id === USERS.repA1.sub && s4row.user_name === 'Rep One', JSON.stringify(s4row))
const s5 = await as('a', `select public.save_stock_validation_session($1, null, 'Typed name', 1, 1, $2::jsonb, 'count-owner') id`,
  [S.A, JSON.stringify([line(lockA, 'After lock', 8, 1, '+')])]).then((r) => r.rows[0].id)
ok('the business login is recorded as Owner', (await sup('select user_name from stock_validation_sessions where id = $1', [s5])).rows[0].user_name === 'Owner')
await expectError('another business still cannot save into it', () => save('repB1', [line(lockA, 'After lock', 9, 1, '+')], 'count-b2', S.A), 'COUNT_FORBIDDEN')
await expectError('nor can someone with no business', () => save('outsider', [line(lockA, 'After lock', 9, 1, '+')], 'count-o', S.A), 'COUNT_FORBIDDEN')
ok('so its stock is unchanged', (await stock(lockA)) === 9)
const def = (await sup(`select prosecdef, proconfig from pg_proc where proname = 'save_stock_validation_session'`)).rows
ok('the function is now the definer with a pinned search_path, still one signature', def.length === 1 && def[0].prosecdef === true
  && String(def[0].proconfig).includes('search_path=public, pg_temp'))

finish()
