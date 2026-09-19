# Stock Management Redesign

**Date:** 2026-09-01  
**Status:** Design Complete  
**Scope:** Rename Inventory → Stock Management, add Stock Validation worksheet, add Stock History audit trail

---

## 1. Overview & Scope

### What This Is
A navigation restructure and two new features:
- Rename the sidebar menu item from "Inventory" → "Stock Management"
- Wrap the existing Inventory feature in a 3-tab module: **Inventory | Stock Validation | Stock History**
- **Stock Validation** — a working worksheet for physical stock-taking and reconciliation
- **Stock History** — a permanent record of completed validation sessions

### What This Is NOT
- Not a new inventory system — the existing Inventory tab remains unchanged
- Not a replacement for the enterprise `stock` module (batch tracking, warehouses, transfers) — that remains a separate sidebar item
- Not pharmacy-specific — applies to all business types (pharmacy, skincare, dental, optical, wellness, hospital, manufacturer_importer, wholesale)

### Core Design Decision
The existing `Inventory` feature is preserved exactly as it works today. Stock Validation is a **worksheet interface** that reads from and writes to the existing `products` table. Stock History is a **read-only audit trail** of completed validation sessions.

---

## 2. Navigation & Module Structure

### Sidebar Change
**File:** `src/lib/permissions.js`

In the `MODULES` registry:
```js
inventory: { 
  label: 'Stock Management',  // Changed from 'Inventory'
  icon: Package, 
  types: ALL_TYPES, 
  section: 'operations' 
}
```

- Label-only change — `id: 'inventory'` remains the same
- Route remains `/dashboard/inventory`
- No changes to permissions, business-type gating, or section placement

### Route Change
**File:** `src/pages/dashboard/BusinessDashboard.jsx`

```jsx
// Before:
<Route path='inventory' element={guard('inventory', 
  <><TopBar title='Inventory' brand={brand} role={role} />
  <div style={{ padding: isMobile ? '16px' : '24px' }}>
    <Inventory {...pageProps} />
  </div></>
)} />

// After:
<Route path='inventory' element={guard('inventory', 
  <><TopBar title='Stock Management' brand={brand} role={role} />
  <div style={{ padding: isMobile ? '16px' : '24px' }}>
    <StockManagement {...pageProps} />
  </div></>
)} />
```

### New Module: Stock Management
**File:** `src/modules/stock-management/StockManagement.jsx`

**Tab shell structure:**
```jsx
export default function StockManagement({ brand, products, setProducts, role, perms, loadProducts }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'inventory'
  
  const tabs = [
    { id: 'inventory', label: 'Inventory' },
    { id: 'validation', label: 'Stock Validation' },
    { id: 'history', label: 'Stock History' }
  ]
  
  return (
    <>
      <TabBar tabs={tabs} activeTab={activeTab} onChange={tab => setSearchParams({ tab })} />
      {activeTab === 'inventory' && <Inventory {...{ brand, products, setProducts, role, perms, loadProducts }} />}
      {activeTab === 'validation' && <StockValidation {...{ brand, products, setProducts, loadProducts }} />}
      {activeTab === 'history' && <StockHistory {...{ brand }} />}
    </>
  )
}
```

**Tab state via URL query param** (`?tab=inventory|validation|history`) for:
- Deep-linking (share a link to the validation worksheet)
- Back-button support (browser history tracks tab changes)
- Default tab: `inventory`

### Files Touched
1. `src/lib/permissions.js` — label change only (1 line)
2. `src/pages/dashboard/BusinessDashboard.jsx` — import swap + TopBar title (2 lines)
3. `src/modules/stock-management/StockManagement.jsx` — new tab shell (new file)
4. `src/modules/inventory/Inventory.jsx` — **no changes** (preserved as-is)

---

## 3. Stock Validation Worksheet

### Component
**File:** `src/modules/stock-management/StockValidation.jsx`

### State Management
```js
const [worksheet, setWorksheet] = useState([])
// Each item: { product, currentStock, adjustmentQty, direction ('+'|'-'), reason }

const [search, setSearch] = useState('')
const [categoryFilter, setCategoryFilter] = useState('All')
```

- Local component state (not global) — the worksheet is ephemeral until saved
- `products` prop is already loaded by `BusinessDashboard` and passed down

### Product Addition Flow

**Search bar + category pills at top:**
```jsx
<div>
  <SearchInput value={search} onChange={setSearch} placeholder="Search products..." />
  <CategoryPills categories={categories} active={categoryFilter} onChange={setCategoryFilter} />
</div>
```

**Search behavior:**
- Matches against `products` array (name, generic_name, barcode)
- Shows results in a dropdown below the search bar
- Click a result → add to worksheet

**Category selection:**
- Click a category pill → filters products to that category
- Shows "Add All" button when category is selected
- "Add All" → adds all products in that category to the worksheet
- Individual products can still be added from the filtered list

**Duplicate prevention (strict ID-based):**
```js
function addProductToWorksheet(product) {
  const alreadyExists = worksheet.some(w => w.product.id === product.id)
  
  if (alreadyExists) {
    showToast('This product is already on the validation screen', { type: 'warning' })
    // Scroll to existing row
    const rowIndex = worksheet.findIndex(w => w.product.id === product.id)
    scrollToRow(rowIndex)
    highlightRow(rowIndex) // Brief animation
    return
  }
  
  setWorksheet([...worksheet, {
    product,
    currentStock: product.stock,
    adjustmentQty: 0,
    direction: '+',
    reason: ''
  }])
}
```

- Check `product.id` — exact match, no fuzzy matching
- If duplicate: show toast, scroll to row, highlight with animation
- No name-based duplicate detection (unlike Inventory's `findDuplicate`)

### Worksheet Row Structure

```jsx
<div className="worksheet-row">
  <div className="product-info">
    <div className="product-name">{product.name}</div>
    {product.shelf_label && <div className="shelf-label">Shelf: {product.shelf_label}</div>}
    <Pill label={product.category} type="teal" />
  </div>
  
  <div className="current-stock">
    Current Stock: <strong>{currentStock}</strong>
  </div>
  
  <div className="adjustment-controls">
    <button onClick={() => adjustQty(-1)}>−</button>
    <input 
      type="number" 
      value={adjustmentQty} 
      onChange={e => setAdjustmentQty(parseInt(e.target.value) || 0)}
    />
    <button onClick={() => adjustQty(1)}>+</button>
    
    <select value={direction} onChange={e => setDirection(e.target.value)}>
      <option value="+">Add</option>
      <option value="-">Remove</option>
    </select>
  </div>
  
  <div className="pricing">
    <div>Unit Price: ₦{formatPrice(product.price)}</div>
    <div>Subtotal: ₦{formatPrice(adjustmentQty * product.price)}</div>
  </div>
  
  <div className="reason">
    <select value={reason} onChange={e => setReason(e.target.value)}>
      <option value="">Select reason...</option>
      <option value="Physical stock discrepancy">Physical stock discrepancy</option>
      <option value="Damaged stock">Damaged stock</option>
      <option value="Expired stock">Expired stock</option>
      <option value="Missing stock">Missing stock</option>
      <option value="Excess stock found">Excess stock found</option>
      <option value="Returned stock">Returned stock</option>
      <option value="Data correction">Data correction</option>
      <option value="Other">Other</option>
    </select>
  </div>
</div>
```

**Adjustment logic:**
- `+` button increments `adjustmentQty` by 1
- `−` button decrements (min 0)
- `direction` toggle: `+` means adding stock, `−` means removing
- Subtotal = `adjustmentQty × product.price` (display only — sign tracked internally)
- Row background tint:
  - Green if `direction === '+'` (excess)
  - Red if `direction === '-'` (shortage)
  - Neutral if `adjustmentQty === 0` (no change)

### Validation Summary (Before Save)

**Trigger:** User clicks "Save Validation" button

**Modal content:**
```jsx
<Modal title="Validation Summary">
  <div className="summary-stats">
    <div>Products checked: {worksheet.length}</div>
    <div>No difference: {worksheet.filter(w => w.adjustmentQty === 0).length}</div>
    <div>Shortage: {worksheet.filter(w => w.direction === '-' && w.adjustmentQty > 0).length}</div>
    <div>Excess: {worksheet.filter(w => w.direction === '+' && w.adjustmentQty > 0).length}</div>
    <div>Products adjusted: {worksheet.filter(w => w.adjustmentQty > 0).length}</div>
  </div>
  
  <div className="summary-actions">
    <button onClick={handleCancel}>Cancel</button>
    <button onClick={handleConfirmSave}>Save Validation</button>
  </div>
</Modal>
```

### Save Flow

```js
async function handleSave() {
  // 1. Show summary modal
  setShowSummaryModal(true)
}

async function handleConfirmSave() {
  try {
    // 2. Build session data
    const session = {
      user_name: auth.staff.full_name,
      products_checked: worksheet.length,
      products_adjusted: worksheet.filter(w => w.adjustmentQty > 0).length,
      status: 'completed'
    }
    
    // 3. Build items data
    const items = worksheet.map(w => ({
      product_id: w.product.id,
      product_name: w.product.name,
      shelf_label: w.product.shelf_label,
      previous_stock: w.currentStock,
      adjustment_qty: w.adjustmentQty,
      adjustment_direction: w.direction,
      new_stock: w.direction === '+' 
        ? w.currentStock + w.adjustmentQty 
        : w.currentStock - w.adjustmentQty,
      reason: w.reason,
      unit_price: w.product.price
    }))
    
    // 4. Save atomically
    await stockValidationRepository.saveSession(brand.id, session, items)
    
    // 5. Success
    showToast('Validation saved successfully', { type: 'success' })
    setWorksheet([]) // Clear worksheet
    loadProducts() // Refresh products
    
  } catch (error) {
    showToast('Could not save validation: ' + error.message, { type: 'error' })
  }
}
```

### Empty States

**Before any products added:**
```jsx
<EmptyState 
  icon={<Package size={80} />}
  message="Search or choose a category to start your stock validation"
/>
```

**Loading state while saving:**
```jsx
<Loading message="Saving validation..." />
```

### Responsive Requirements

- Desktop: full-width worksheet, all columns visible
- Tablet: stack pricing below adjustment controls
- Mobile: stack all info vertically, large tap targets for +/− buttons

---

## 4. Stock History

### Component
**File:** `src/modules/stock-management/StockHistory.jsx`

### List View (Default)

**Table/card list of completed validation sessions:**

```jsx
<DataTable
  rows={sessions}
  columns={[
    { key: 'created_at', label: 'Date', render: s => formatDate(s.created_at) },
    { key: 'user_name', label: 'User', render: s => s.user_name },
    { key: 'products_checked', label: 'Checked', render: s => s.products_checked },
    { key: 'products_adjusted', label: 'Adjusted', render: s => s.products_adjusted },
    { key: 'status', label: 'Status', render: s => <Pill label={s.status} type="green" /> }
  ]}
  onRowClick={session => setSelectedSession(session)}
/>
```

- Sorted by `created_at` descending (newest first)
- Paginated: 25 sessions per page
- Optional filter: date range (from/to)

### Detail View

**Trigger:** Click a session row

**Session header:**
```jsx
<div className="session-header">
  <button onClick={() => setSelectedSession(null)}>← Back</button>
  <div className="session-meta">
    <div>Date: {formatDate(session.created_at)}</div>
    <div>User: {session.user_name}</div>
    <div>Products checked: {session.products_checked}</div>
    <div>Products adjusted: {session.products_adjusted}</div>
  </div>
</div>
```

**Product-level changes table:**
```jsx
<DataTable
  rows={session.items}
  columns={[
    { key: 'product_name', label: 'Product', render: i => (
      <>
        <div>{i.product_name}</div>
        {i.shelf_label && <div className="shelf-label">Shelf: {i.shelf_label}</div>}
      </>
    )},
    { key: 'previous_stock', label: 'Previous', render: i => i.previous_stock },
    { key: 'adjustment', label: 'Adjustment', render: i => (
      <span className={i.adjustment_direction === '+' ? 'text-green' : 'text-red'}>
        {i.adjustment_direction}{i.adjustment_qty}
      </span>
    )},
    { key: 'new_stock', label: 'New', render: i => i.new_stock },
    { key: 'reason', label: 'Reason', render: i => i.reason || '—' },
    { key: 'unit_price', label: 'Unit Price', render: i => formatPrice(i.unit_price) }
  ]}
/>
```

### Data Source

```js
async function loadSessions() {
  const sessions = await stockValidationRepository.getSessions(brand.id)
  setSessions(sessions)
}

async function loadSessionDetail(sessionId) {
  const session = await stockValidationRepository.getSessionById(sessionId, brand.id)
  setSelectedSession(session)
}
```

- Queries `stock_validation_sessions` joined with `stock_validation_items`
- Paginated list (25 per page)

### Audit Trail Integrity

- Sessions are **read-only** — no edit/delete UI
- Any correction creates a new session (spec §23)
- No RLS policies allow UPDATE/DELETE on sessions or items

### Empty State

```jsx
<EmptyState 
  icon={<History size={80} />}
  message="No validation sessions yet. Complete your first stock validation to see history here."
/>
```

---

## 5. Data Model & Repository

### New Tables

**File:** `sql/20260901_stock_validation.sql`

```sql
-- Stock validation sessions (one per validation event)
CREATE TABLE IF NOT EXISTS stock_validation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  products_checked int NOT NULL DEFAULT 0,
  products_adjusted int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_validation_sessions_business 
  ON stock_validation_sessions(business_id);

CREATE INDEX IF NOT EXISTS idx_stock_validation_sessions_created 
  ON stock_validation_sessions(created_at DESC);

-- Stock validation items (one per product in a session)
CREATE TABLE IF NOT EXISTS stock_validation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES stock_validation_sessions(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  shelf_label text,
  previous_stock int NOT NULL,
  adjustment_qty int NOT NULL,
  adjustment_direction text NOT NULL CHECK (adjustment_direction IN ('+', '-')),
  new_stock int NOT NULL,
  reason text,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_validation_items_session 
  ON stock_validation_items(session_id);

CREATE INDEX IF NOT EXISTS idx_stock_validation_items_product 
  ON stock_validation_items(product_id);
```

### Products Table Change

```sql
-- Add shelf_label column to products
ALTER TABLE products ADD COLUMN IF NOT EXISTS shelf_label text;
```

### RLS Policies

```sql
-- Enable RLS
ALTER TABLE stock_validation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_validation_items ENABLE ROW LEVEL SECURITY;

-- Sessions: scoped to business via current_business_ids() (matches products table pattern)
CREATE POLICY "stock_validation_sessions tenant visibility" 
  ON stock_validation_sessions FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

-- Items: scoped via parent session (join-through-parent pattern)
CREATE POLICY "stock_validation_items tenant visibility" 
  ON stock_validation_items FOR ALL
  USING (
    session_id IN (
      SELECT id FROM stock_validation_sessions 
      WHERE business_id IN (SELECT current_business_ids()) OR is_platform_admin()
    )
  )
  WITH CHECK (
    session_id IN (
      SELECT id FROM stock_validation_sessions 
      WHERE business_id IN (SELECT current_business_ids()) OR is_platform_admin()
    )
  );

-- No separate UPDATE/DELETE policies — sessions are immutable audit trail
-- (the ALL policy above covers SELECT/INSERT only; UPDATE/DELETE are not granted)
```

### Repository

**File:** `src/modules/stock-management/repositories/index.js`

```js
import { sbFetch } from '../../../services/supabase'

export function createStockValidationRepository(request = sbFetch) {
  return {
    // Atomic save: insert session + items + update products
    async saveSession(businessId, session, items) {
      // 1. Insert session
      const sessionResult = await request('stock_validation_sessions', {
        method: 'POST',
        body: JSON.stringify({ ...session, business_id: businessId }),
      })
      const sessionId = sessionResult.id
      
      // 2. Insert all items
      const itemsWithSessionId = items.map(item => ({ ...item, session_id: sessionId }))
      await request('stock_validation_items', {
        method: 'POST',
        body: JSON.stringify(itemsWithSessionId),
      })
      
      // 3. Update product stock for each item
      for (const item of items) {
        await request(`products?id=eq.${item.product_id}&business_id=eq.${businessId}`, {
          method: 'PATCH',
          body: JSON.stringify({ stock: item.new_stock }),
          prefer: 'return=minimal',
        })
      }
      
      return { sessionId, itemsCount: items.length }
    },
    
    // List sessions with summary counts
    async getSessions(businessId) {
      return request(
        `stock_validation_sessions?business_id=eq.${businessId}&order=created_at.desc&select=*`
      )
    },
    
    // Get session with its items
    async getSessionById(sessionId, businessId) {
      const sessionResult = await request(
        `stock_validation_sessions?id=eq.${sessionId}&business_id=eq.${businessId}&select=*`
      )
      const session = sessionResult[0]
      
      if (!session) return null
      
      const items = await request(
        `stock_validation_items?session_id=eq.${sessionId}&order=created_at.asc&select=*`
      )
      
      return { ...session, items }
    }
  }
}

export const stockValidationRepository = createStockValidationRepository()
```

### Atomic Save Logic

**Current implementation:** Sequential inserts + updates (not truly transactional)

**Ideal implementation:** Postgres function that does all three in one transaction

```sql
CREATE OR REPLACE FUNCTION save_stock_validation_session(
  p_business_id uuid,
  p_user_id uuid,
  p_user_name text,
  p_products_checked int,
  p_products_adjusted int,
  p_items jsonb
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_session_id uuid;
  v_item jsonb;
BEGIN
  -- 1. Insert session
  INSERT INTO stock_validation_sessions (business_id, user_id, user_name, products_checked, products_adjusted)
  VALUES (p_business_id, p_user_id, p_user_name, p_products_checked, p_products_adjusted)
  RETURNING id INTO v_session_id;
  
  -- 2. Insert items and update products
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO stock_validation_items (
      session_id, product_id, product_name, shelf_label, 
      previous_stock, adjustment_qty, adjustment_direction, new_stock, 
      reason, unit_price
    ) VALUES (
      v_session_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      v_item->>'shelf_label',
      (v_item->>'previous_stock')::int,
      (v_item->>'adjustment_qty')::int,
      v_item->>'adjustment_direction',
      (v_item->>'new_stock')::int,
      v_item->>'reason',
      (v_item->>'unit_price')::numeric
    );
    
    -- Update product stock
    UPDATE products 
    SET stock = (v_item->>'new_stock')::int
    WHERE id = (v_item->>'product_id')::uuid 
    AND business_id = p_business_id;
  END LOOP;
  
  RETURN v_session_id;
END;
$$;
```

**Repository update to use RPC:**
```js
async saveSession(businessId, session, items) {
  const result = await request('rpc/save_stock_validation_session', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: businessId,
      p_user_id: auth.uid(),
      p_user_name: session.user_name,
      p_products_checked: session.products_checked,
      p_products_adjusted: session.products_adjusted,
      p_items: items
    })
  })
  return { sessionId: result, itemsCount: items.length }
}
```

---

## 6. Shelf Label Feature

### Products Table Change

```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS shelf_label text;
```

### Inventory Module Update

**File:** `src/modules/inventory/Inventory.jsx`

**ProductModal addition:**
```jsx
<Inp 
  label='Shelf Label' 
  value={form.shelf_label} 
  onChange={v => f('shelf_label', v)} 
  placeholder='e.g. A-03, Rack B Shelf 3' 
/>
```

**DataTable column addition:**
```jsx
{
  key: 'shelf_label', 
  label: 'Shelf', 
  sortable: true,
  render: p => <span style={{ fontSize: '12px', color: gray500 }}>{p.shelf_label || '—'}</span>
}
```

### Stock Validation Integration

- Display shelf label in worksheet row (if present)
- Display shelf label in Stock History detail view
- Optional: sort worksheet by shelf label for efficient physical counting

---

## 7. Acceptance Criteria

### Navigation & Structure
- [ ] Sidebar menu item renamed from "Inventory" → "Stock Management"
- [ ] Stock Management page has 3 tabs: Inventory, Stock Validation, Stock History
- [ ] Existing Inventory functionality remains intact (no changes)
- [ ] Tab state persists in URL query param (`?tab=`)
- [ ] Default tab is Inventory

### Stock Validation
- [ ] Stock Validation opens as a dedicated working worksheet
- [ ] Products can be searched and added without leaving the worksheet
- [ ] Products can be selected individually from search results
- [ ] An entire category can be added at once ("Add All" button)
- [ ] Current stock is clearly displayed for each product
- [ ] Adjustment uses − / quantity / + controls
- [ ] Unit price is displayed
- [ ] Subtotal updates from adjustment quantity × unit price
- [ ] Adjustment reason can be recorded (dropdown with 8 options)
- [ ] The same exact inventory product cannot appear twice (ID-based duplicate check)
- [ ] A duplicate attempt shows a friendly message
- [ ] A duplicate attempt automatically scrolls to and highlights the existing row
- [ ] The user can continue working after a duplicate warning
- [ ] Validation summary is shown before save (products checked, shortage, excess, adjusted)
- [ ] The whole validation can be saved once at the end
- [ ] Saving updates the existing Inventory (products table)
- [ ] Saving creates a Stock History record (session + items)
- [ ] Save is atomic (all-or-nothing via Postgres RPC)

### Stock History
- [ ] History shows list of completed validation sessions (newest first)
- [ ] Each session shows: date, user, products checked, products adjusted, status
- [ ] Clicking a session drills into detail view
- [ ] Detail view shows: product name, shelf label, previous stock, adjustment, new stock, reason, unit price
- [ ] History is read-only (no edit/delete)
- [ ] Empty state shows helpful message

### Shelf Label
- [ ] Shelf Label field is available in Inventory product modal
- [ ] Shelf Label is displayed in Inventory table
- [ ] Shelf Label is displayed in Stock Validation worksheet
- [ ] Shelf Label is displayed in Stock History detail view

### Cross-Business-Type Compatibility
- [ ] Works for all business types (pharmacy, skincare, dental, optical, wellness, hospital, manufacturer_importer, wholesale)
- [ ] No pharmacy-specific logic in the implementation
- [ ] Uses existing product categories from each business type

### Responsive Design
- [ ] Worksheet works on desktop, tablet, mobile
- [ ] Product rows are clear and readable at all breakpoints
- [ ] Controls are large enough to tap on mobile
- [ ] Smooth scrolling through long worksheets

### Data Integrity
- [ ] Existing Inventory, Purchases, Reports and other CareHub functions are not broken
- [ ] No unnecessary duplicate stock modules introduced
- [ ] Experience is simple, fast, pharmacy-friendly and suitable for long stock-taking sessions

---

## 8. Implementation Notes

### What to Preserve
- Existing `Inventory.jsx` — no changes to its functionality
- Existing `productRepository` — still the source of truth for products
- Existing `products` table schema (only add `shelf_label` column)

### What to Build
- `StockManagement.jsx` — tab shell
- `StockValidation.jsx` — worksheet component
- `StockHistory.jsx` — history list + detail view
- `repositories/index.js` — stock validation repository
- `sql/20260901_stock_validation.sql` — new tables + RPC function

### What to Update
- `permissions.js` — label change
- `BusinessDashboard.jsx` — import + route
- `Inventory.jsx` — add shelf label field to modal + table column

### Testing Strategy
- Unit tests for duplicate detection logic
- Unit tests for adjustment calculation (new_stock = previous ± adjustment)
- Integration test for atomic save (session + items + product updates)
- Manual test: complete a validation session end-to-end
- Manual test: verify Stock History shows the session correctly
- Manual test: verify Inventory reflects the updated stock

---

## 9. Out of Scope

These are explicitly NOT part of this task:
- Stock In / Stock Out modules
- Low Stock alerts module
- Expiry Management module
- Stock Movement reports
- Stock Adjustment module (separate from Validation)
- Changes to the enterprise `stock` module (batches, warehouses, transfers)
- Changes to Purchases or Reports modules

---

**End of Design Spec**
