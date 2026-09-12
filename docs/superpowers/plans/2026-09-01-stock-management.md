# Stock Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename Inventory to Stock Management and add Stock Validation worksheet + Stock History audit trail

**Architecture:** 3-tab module wrapping existing Inventory, with new Stock Validation (physical stock-taking worksheet) and Stock History (read-only audit trail). Data model uses session-based tables with atomic save via Postgres RPC.

**Tech Stack:** React, Supabase (Postgres + PostgREST), Vite, Vitest

**Spec:** `docs/superpowers/specs/2026-09-01-stock-management-design.md`

## Global Constraints

- Preserve existing Inventory functionality — no changes to `Inventory.jsx` behavior
- Apply to all business types (pharmacy, skincare, dental, optical, wellness, hospital, manufacturer_importer, wholesale)
- No pharmacy-specific logic
- RLS policies must match existing `products` table pattern using `current_business_ids()` function
- Atomic save via Postgres RPC function
- Tab state via URL query param (`?tab=`)

---

## File Structure

### New Files
- `sql/20260901_stock_validation.sql` — database schema (tables, indexes, RPC function, RLS policies)
- `src/modules/stock-management/StockManagement.jsx` — tab shell component
- `src/modules/stock-management/StockValidation.jsx` — validation worksheet
- `src/modules/stock-management/StockHistory.jsx` — history list + detail view
- `src/modules/stock-management/repositories/index.js` — stock validation repository
- `src/modules/stock-management/repositories/index.test.js` — repository tests

### Modified Files
- `src/lib/permissions.js:223` — rename `inventory` label from `'Inventory'` to `'Stock Management'`
- `src/pages/dashboard/BusinessDashboard.jsx:24,195` — import `StockManagement`, update route + TopBar title
- `src/modules/inventory/Inventory.jsx:782,468` — add `shelf_label` field to ProductModal + DataTable column

---

## Task 1: Database Schema

**Files:**
- Create: `sql/20260901_stock_validation.sql`

**Interfaces:**
- Produces: `stock_validation_sessions` table, `stock_validation_items` table, `save_stock_validation_session()` RPC function, RLS policies

- [ ] **Step 1: Create SQL migration file**

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

-- Add shelf_label column to products
ALTER TABLE products ADD COLUMN IF NOT EXISTS shelf_label text;
```

- [ ] **Step 2: Add RPC function for atomic save**

```sql
-- Atomic save: insert session + items + update products in one transaction
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
  INSERT INTO stock_validation_sessions (
    business_id, user_id, user_name, products_checked, products_adjusted
  ) VALUES (
    p_business_id, p_user_id, p_user_name, p_products_checked, p_products_adjusted
  )
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

- [ ] **Step 3: Add RLS policies**

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
```

- [ ] **Step 4: Commit SQL migration**

```bash
git add sql/20260901_stock_validation.sql
git commit -m "feat: add stock validation database schema

- stock_validation_sessions table (one per validation event)
- stock_validation_items table (one per product adjustment)
- save_stock_validation_session() RPC for atomic save
- shelf_label column on products table
- RLS policies matching products table pattern"
```

---

## Task 2: Repository Layer

**Files:**
- Create: `src/modules/stock-management/repositories/index.js`
- Create: `src/modules/stock-management/repositories/index.test.js`

**Interfaces:**
- Consumes: `sbFetch` from `src/services/supabase.js`
- Produces: `stockValidationRepository` with `saveSession()`, `getSessions()`, `getSessionById()`

- [ ] **Step 1: Write failing test for saveSession**

```js
// src/modules/stock-management/repositories/index.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStockValidationRepository } from './index.js'

describe('stockValidationRepository', () => {
  let mockRequest
  let repo

  beforeEach(() => {
    mockRequest = vi.fn()
    repo = createStockValidationRepository(mockRequest)
  })

  describe('saveSession', () => {
    it('calls RPC with correct parameters', async () => {
      const businessId = 'biz-123'
      const session = {
        user_name: 'John Doe',
        products_checked: 5,
        products_adjusted: 2,
      }
      const items = [
        {
          product_id: 'prod-1',
          product_name: 'Amoxicillin',
          shelf_label: 'A-03',
          previous_stock: 50,
          adjustment_qty: 3,
          adjustment_direction: '+',
          new_stock: 53,
          reason: 'Physical stock discrepancy',
          unit_price: 1500,
        },
      ]

      mockRequest.mockResolvedValue('session-id-123')

      const result = await repo.saveSession(businessId, session, items, 'user-456')

      expect(mockRequest).toHaveBeenCalledWith('rpc/save_stock_validation_session', {
        method: 'POST',
        body: JSON.stringify({
          p_business_id: businessId,
          p_user_id: 'user-456',
          p_user_name: 'John Doe',
          p_products_checked: 5,
          p_products_adjusted: 2,
          p_items: items,
        }),
      })
      expect(result).toEqual({ sessionId: 'session-id-123', itemsCount: 1 })
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/stock-management/repositories/index.test.js`
Expected: FAIL with "createStockValidationRepository is not defined"

- [ ] **Step 3: Implement repository**

```js
// src/modules/stock-management/repositories/index.js
import { sbFetch } from '../../../services/supabase'

export function createStockValidationRepository(request = sbFetch) {
  return {
    async saveSession(businessId, session, items, userId) {
      const result = await request('rpc/save_stock_validation_session', {
        method: 'POST',
        body: JSON.stringify({
          p_business_id: businessId,
          p_user_id: userId,
          p_user_name: session.user_name,
          p_products_checked: session.products_checked,
          p_products_adjusted: session.products_adjusted,
          p_items: items,
        }),
      })
      return { sessionId: result, itemsCount: items.length }
    },

    async getSessions(businessId) {
      return request(
        `stock_validation_sessions?business_id=eq.${businessId}&order=created_at.desc&select=*`
      )
    },

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
    },
  }
}

export const stockValidationRepository = createStockValidationRepository()
```

- [ ] **Step 4: Add tests for getSessions and getSessionById**

```js
// Add to src/modules/stock-management/repositories/index.test.js

describe('getSessions', () => {
  it('fetches sessions for business ordered by created_at desc', async () => {
    const businessId = 'biz-123'
    const mockSessions = [
      { id: 's1', created_at: '2026-09-01T10:00:00Z' },
      { id: 's2', created_at: '2026-09-01T09:00:00Z' },
    ]
    mockRequest.mockResolvedValue(mockSessions)

    const result = await repo.getSessions(businessId)

    expect(mockRequest).toHaveBeenCalledWith(
      `stock_validation_sessions?business_id=eq.${businessId}&order=created_at.desc&select=*`
    )
    expect(result).toEqual(mockSessions)
  })
})

describe('getSessionById', () => {
  it('fetches session with items', async () => {
    const sessionId = 'session-123'
    const businessId = 'biz-123'
    const mockSession = { id: sessionId, user_name: 'John Doe' }
    const mockItems = [
      { id: 'i1', product_name: 'Amoxicillin' },
      { id: 'i2', product_name: 'Paracetamol' },
    ]

    mockRequest
      .mockResolvedValueOnce([mockSession])
      .mockResolvedValueOnce(mockItems)

    const result = await repo.getSessionById(sessionId, businessId)

    expect(mockRequest).toHaveBeenNthCalledWith(
      1,
      `stock_validation_sessions?id=eq.${sessionId}&business_id=eq.${businessId}&select=*`
    )
    expect(mockRequest).toHaveBeenNthCalledWith(
      2,
      `stock_validation_items?session_id=eq.${sessionId}&order=created_at.asc&select=*`
    )
    expect(result).toEqual({ ...mockSession, items: mockItems })
  })

  it('returns null if session not found', async () => {
    mockRequest.mockResolvedValueOnce([])

    const result = await repo.getSessionById('nonexistent', 'biz-123')

    expect(result).toBeNull()
  })
})
```

- [ ] **Step 5: Run all tests to verify they pass**

Run: `npm test -- src/modules/stock-management/repositories/index.test.js`
Expected: All tests PASS

- [ ] **Step 6: Commit repository**

```bash
git add src/modules/stock-management/repositories/
git commit -m "feat: add stock validation repository

- saveSession() calls RPC for atomic save
- getSessions() fetches sessions for business
- getSessionById() fetches session with items
- Full test coverage"
```

---

## Task 3: Navigation Rename

**Files:**
- Modify: `src/lib/permissions.js:223`

**Interfaces:**
- Consumes: Nothing new
- Produces: Sidebar label change (no route/ID changes)

- [ ] **Step 1: Update MODULES registry label**

```js
// src/lib/permissions.js line 223
// Change:
inventory: { label: 'Inventory', icon: Package, types: ALL_TYPES, section: 'operations' },

// To:
inventory: { label: 'Stock Management', icon: Package, types: ALL_TYPES, section: 'operations' },
```

- [ ] **Step 2: Verify no other references to "Inventory" label need updating**

Search for hardcoded "Inventory" strings in sidebar/nav components. The Sidebar.jsx uses `MODULES[id].label`, so no changes needed there.

- [ ] **Step 3: Commit navigation change**

```bash
git add src/lib/permissions.js
git commit -m "feat: rename Inventory to Stock Management in sidebar

Label-only change in MODULES registry. Route and ID remain unchanged."
```

---

## Task 4: Tab Shell Component

**Files:**
- Create: `src/modules/stock-management/StockManagement.jsx`
- Modify: `src/pages/dashboard/BusinessDashboard.jsx:24,195`

**Interfaces:**
- Consumes: `Inventory`, `StockValidation`, `StockHistory` components
- Produces: `StockManagement` component with 3 tabs

- [ ] **Step 1: Create StockManagement tab shell**

```jsx
// src/modules/stock-management/StockManagement.jsx
import { useSearchParams } from 'react-router-dom'
import Inventory from '../inventory/Inventory'
import StockValidation from './StockValidation'
import StockHistory from './StockHistory'
import { theme } from '../../styles/theme'

const TABS = [
  { id: 'inventory', label: 'Inventory' },
  { id: 'validation', label: 'Stock Validation' },
  { id: 'history', label: 'Stock History' },
]

export default function StockManagement(props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'inventory'

  const handleTabChange = (tabId) => {
    setSearchParams({ tab: tabId })
  }

  return (
    <>
      <div style={{ 
        display: 'flex', 
        gap: '8px', 
        marginBottom: '20px',
        borderBottom: `1px solid ${theme.border}`,
        paddingBottom: '12px'
      }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              style={{
                padding: '10px 16px',
                borderRadius: `${theme.radius.md} ${theme.radius.md} 0 0`,
                border: 'none',
                borderBottom: isActive ? `2px solid ${theme.tealDeep}` : '2px solid transparent',
                background: isActive ? theme.tealMist : 'transparent',
                color: isActive ? theme.tealDeep : theme.gray600,
                fontWeight: '700',
                fontSize: '13px',
                cursor: 'pointer',
                transition: `all ${theme.motion.fast} ${theme.motion.easeOut}`,
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'inventory' && <Inventory {...props} />}
      {activeTab === 'validation' && <StockValidation {...props} />}
      {activeTab === 'history' && <StockHistory brand={props.brand} />}
    </>
  )
}
```

- [ ] **Step 2: Update BusinessDashboard route**

```jsx
// src/pages/dashboard/BusinessDashboard.jsx line 24
// Add import:
import StockManagement from '../../modules/stock-management/StockManagement'

// Line 195 - change route:
// From:
<Route path='inventory' element={guard('inventory', <><TopBar title='Inventory' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Inventory {...pageProps} /></div></>)} />

// To:
<Route path='inventory' element={guard('inventory', <><TopBar title='Stock Management' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><StockManagement {...pageProps} /></div></>)} />
```

- [ ] **Step 3: Create placeholder StockValidation and StockHistory components**

```jsx
// src/modules/stock-management/StockValidation.jsx
export default function StockValidation() {
  return <div>Stock Validation (coming soon)</div>
}

// src/modules/stock-management/StockHistory.jsx
export default function StockHistory() {
  return <div>Stock History (coming soon)</div>
}
```

- [ ] **Step 4: Test tab switching manually**

Navigate to `/dashboard/inventory`. Verify:
- Default tab is "Inventory"
- Clicking "Stock Validation" shows placeholder
- Clicking "Stock History" shows placeholder
- URL updates to `?tab=validation` and `?tab=history`
- Back button works correctly

- [ ] **Step 5: Commit tab shell**

```bash
git add src/modules/stock-management/ src/pages/dashboard/BusinessDashboard.jsx
git commit -m "feat: add Stock Management tab shell

- 3 tabs: Inventory, Stock Validation, Stock History
- Tab state via URL query param (?tab=)
- Default tab is Inventory
- Existing Inventory preserved unchanged"
```

---

## Task 5: Shelf Label in Inventory

**Files:**
- Modify: `src/modules/inventory/Inventory.jsx:782,468`

**Interfaces:**
- Consumes: Nothing new
- Produces: `shelf_label` field in ProductModal, column in DataTable

- [ ] **Step 1: Add shelf_label field to ProductModal**

```jsx
// src/modules/inventory/Inventory.jsx line ~782 (inside ProductModal)
// Add after Barcode field:
<Inp 
  label='Shelf Label' 
  value={form.shelf_label} 
  onChange={v => f('shelf_label', v)} 
  placeholder='e.g. A-03, Rack B Shelf 3' 
/>
```

- [ ] **Step 2: Add shelf_label column to DataTable**

```jsx
// src/modules/inventory/Inventory.jsx line ~468 (in columns array)
// Add after 'name' column:
{
  key: 'shelf_label', 
  label: 'Shelf', 
  sortable: true,
  render: p => <span style={{ fontSize: '12px', color: gray500 }}>{p.shelf_label || '—'}</span>
},
```

- [ ] **Step 3: Update saveProduct to include shelf_label**

```jsx
// src/modules/inventory/Inventory.jsx line ~96 (in saveProduct function)
// Add shelf_label to productData:
const productData = {
  ...rest,
  category,
  price: parseFloat(data.price) || 0,
  cost_price: parseFloat(data.cost_price) || 0,
  stock: category === 'Services' ? 999 : parseInt(data.stock) || 0,
  reorder_level: parseInt(data.reorder_level) || 5,
  shelf_label: data.shelf_label || null,  // ADD THIS LINE
}
```

- [ ] **Step 4: Test shelf label manually**

- Add a new product with shelf label "A-03"
- Verify it appears in the Inventory table
- Edit the product and change shelf label to "B-05"
- Verify the change persists

- [ ] **Step 5: Commit shelf label**

```bash
git add src/modules/inventory/Inventory.jsx
git commit -m "feat: add shelf label to Inventory

- Shelf Label field in ProductModal
- Shelf column in DataTable
- Persists to products.shelf_label column"
```

---

## Task 6: Stock Validation Worksheet

**Files:**
- Create: `src/modules/stock-management/StockValidation.jsx`

**Interfaces:**
- Consumes: `products` prop, `stockValidationRepository`, `auth` from AuthProvider
- Produces: Worksheet UI with search, category filter, adjustment controls

- [ ] **Step 1: Create StockValidation component with state**

```jsx
// src/modules/stock-management/StockValidation.jsx
import { useState, useMemo, useRef } from 'react'
import { Search, Plus, Minus, Package } from 'lucide-react'
import { stockValidationRepository } from './repositories'
import { useAuth } from '../../providers/AuthProvider'
import { theme } from '../../styles/theme'
import { Pill, Inp, Modal, GhostBtn, TealBtn, Empty, useToast, Toast } from '../../components/ui'
import { fmt } from '../../lib/utils'

const REASONS = [
  'Physical stock discrepancy',
  'Damaged stock',
  'Expired stock',
  'Missing stock',
  'Excess stock found',
  'Returned stock',
  'Data correction',
  'Other',
]

export default function StockValidation({ brand, products, loadProducts }) {
  const { auth } = useAuth()
  const { msg: toastMsg, type: toastType, show: showToast } = useToast()
  
  const [worksheet, setWorksheet] = useState([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [showSummary, setShowSummary] = useState(false)
  const [saving, setSaving] = useState(false)
  
  const rowRefs = useRef({})
  
  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.cat || p.category))
    return ['All', ...Array.from(cats).sort()]
  }, [products])
  
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const pCat = p.cat || p.category || ''
      if (categoryFilter !== 'All' && pCat !== categoryFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const inName = (p.name || '').toLowerCase().includes(q)
        const inGeneric = (p.generic_name || '').toLowerCase().includes(q)
        const inBarcode = (p.barcode || '').toLowerCase().includes(q)
        if (!inName && !inGeneric && !inBarcode) return false
      }
      return true
    })
  }, [products, categoryFilter, search])
  
  // ... rest of component
}
```

- [ ] **Step 2: Add product addition logic with duplicate prevention**

```jsx
// Add to StockValidation.jsx

function addProduct(product) {
  const alreadyExists = worksheet.some(w => w.product.id === product.id)
  
  if (alreadyExists) {
    showToast('This product is already on the validation screen', { type: 'warning' })
    const rowIndex = worksheet.findIndex(w => w.product.id === product.id)
    const rowEl = rowRefs.current[rowIndex]
    if (rowEl) {
      rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      rowEl.style.transition = 'background 0.3s'
      rowEl.style.background = theme.warningBg
      setTimeout(() => {
        rowEl.style.background = ''
      }, 1500)
    }
    return
  }
  
  setWorksheet([...worksheet, {
    product,
    currentStock: product.stock,
    adjustmentQty: 0,
    direction: '+',
    reason: '',
  }])
}

function addAllInCategory() {
  const categoryProducts = filteredProducts.filter(p => {
    const pCat = p.cat || p.category || ''
    return categoryFilter !== 'All' && pCat === categoryFilter
  })
  
  const newItems = categoryProducts.filter(p => 
    !worksheet.some(w => w.product.id === p.id)
  ).map(p => ({
    product: p,
    currentStock: p.stock,
    adjustmentQty: 0,
    direction: '+',
    reason: '',
  }))
  
  if (newItems.length === 0) {
    showToast('All products in this category are already on the worksheet', { type: 'info' })
    return
  }
  
  setWorksheet([...worksheet, ...newItems])
  showToast(`Added ${newItems.length} product(s)`, { type: 'success' })
}
```

- [ ] **Step 3: Add adjustment controls**

```jsx
// Add to StockValidation.jsx

function updateWorksheetItem(index, updates) {
  setWorksheet(worksheet.map((item, i) => 
    i === index ? { ...item, ...updates } : item
  ))
}

function adjustQty(index, delta) {
  const item = worksheet[index]
  const newQty = Math.max(0, item.adjustmentQty + delta)
  updateWorksheetItem(index, { adjustmentQty: newQty })
}
```

- [ ] **Step 4: Add save logic**

```jsx
// Add to StockValidation.jsx

async function handleSave() {
  setShowSummary(true)
}

async function confirmSave() {
  setSaving(true)
  try {
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
      unit_price: w.product.price,
    }))
    
    await stockValidationRepository.saveSession(
      brand.id,
      {
        user_name: auth.staff?.full_name || 'Owner',
        products_checked: worksheet.length,
        products_adjusted: worksheet.filter(w => w.adjustmentQty > 0).length,
      },
      items,
      auth.staff?.id || null
    )
    
    showToast('Validation saved successfully', { type: 'success' })
    setWorksheet([])
    setShowSummary(false)
    loadProducts()
  } catch (error) {
    showToast('Could not save validation: ' + error.message, { type: 'error' })
  }
  setSaving(false)
}
```

- [ ] **Step 5: Add UI rendering**

```jsx
// Add to StockValidation.jsx return statement

return (
  <>
    <div style={{ marginBottom: '20px' }}>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '200px', display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
          <Search size={15} color={theme.gray400} style={{ flexShrink: 0 }} />
          <input 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            placeholder='Search products...'
            style={{ flex: 1, padding: '10px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: theme.navy, minWidth: 0 }} 
          />
        </div>
        {categoryFilter !== 'All' && (
          <TealBtn onClick={addAllInCategory}>
            Add All in {categoryFilter}
          </TealBtn>
        )}
      </div>
      
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {categories.map(c => {
          const on = categoryFilter === c
          return (
            <button 
              key={c} 
              onClick={() => setCategoryFilter(c)} 
              style={{ 
                padding: '8px 14px', 
                borderRadius: theme.radius.full, 
                border: `1px solid ${on ? theme.tealDeep : theme.border}`, 
                cursor: 'pointer', 
                fontSize: '12px', 
                fontWeight: '700', 
                background: on ? theme.tealDeep : 'white', 
                color: on ? 'white' : theme.gray600 
              }}
            >
              {c}
            </button>
          )
        })}
      </div>
      
      {filteredProducts.length > 0 && (
        <div style={{ maxHeight: '300px', overflowY: 'auto', border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, background: 'white' }}>
          {filteredProducts.slice(0, 20).map(p => (
            <div 
              key={p.id} 
              onClick={() => addProduct(p)}
              style={{ 
                padding: '12px', 
                borderBottom: `1px solid ${theme.gray100}`, 
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                <div style={{ fontWeight: '700', fontSize: '13px', color: theme.navy }}>{p.name}</div>
                {p.generic_name && <div style={{ fontSize: '12px', color: theme.gray500 }}>{p.generic_name}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '13px', fontWeight: '700' }}>{fmt(p.price)}</div>
                <div style={{ fontSize: '12px', color: theme.gray500 }}>Stock: {p.stock}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    
    {worksheet.length === 0 ? (
      <Empty 
        icon={<Package size={80} />}
        message="Search or choose a category to start your stock validation"
      />
    ) : (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
          {worksheet.map((item, index) => {
            const hasChange = item.adjustmentQty > 0
            const bg = !hasChange ? 'white' : item.direction === '+' ? theme.successBg : theme.dangerBg
            
            return (
              <div 
                key={item.product.id}
                ref={el => rowRefs.current[index] = el}
                style={{ 
                  padding: '16px', 
                  borderRadius: theme.radius.lg, 
                  border: `1px solid ${theme.border}`,
                  background: bg
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ fontWeight: '800', fontSize: '15px', color: theme.navy }}>{item.product.name}</div>
                    {item.product.shelf_label && (
                      <div style={{ fontSize: '12px', color: theme.gray500, marginTop: '2px' }}>
                        Shelf: {item.product.shelf_label}
                      </div>
                    )}
                    <Pill label={item.product.cat || item.product.category} type="teal" />
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: '700', color: theme.navy }}>
                    Current Stock: {item.currentStock}
                  </div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                  <button 
                    onClick={() => adjustQty(index, -1)}
                    style={{ 
                      width: '36px', 
                      height: '36px', 
                      borderRadius: theme.radius.md, 
                      border: `1px solid ${theme.border}`, 
                      background: 'white', 
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <Minus size={18} />
                  </button>
                  <input 
                    type="number"
                    value={item.adjustmentQty}
                    onChange={e => updateWorksheetItem(index, { adjustmentQty: Math.max(0, parseInt(e.target.value) || 0) })}
                    style={{ 
                      width: '80px', 
                      padding: '8px', 
                      borderRadius: theme.radius.md, 
                      border: `1px solid ${theme.border}`, 
                      fontSize: '16px', 
                      fontWeight: '700',
                      textAlign: 'center'
                    }}
                  />
                  <button 
                    onClick={() => adjustQty(index, 1)}
                    style={{ 
                      width: '36px', 
                      height: '36px', 
                      borderRadius: theme.radius.md, 
                      border: `1px solid ${theme.border}`, 
                      background: 'white', 
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <Plus size={18} />
                  </button>
                  <select 
                    value={item.direction}
                    onChange={e => updateWorksheetItem(index, { direction: e.target.value })}
                    style={{ 
                      padding: '8px 12px', 
                      borderRadius: theme.radius.md, 
                      border: `1px solid ${theme.border}`, 
                      fontSize: '13px',
                      fontWeight: '700'
                    }}
                  >
                    <option value="+">Add</option>
                    <option value="-">Remove</option>
                  </select>
                </div>
                
                <div style={{ display: 'flex', gap: '20px', marginBottom: '12px', fontSize: '13px', flexWrap: 'wrap' }}>
                  <div>Unit Price: <strong>{fmt(item.product.price)}</strong></div>
                  <div>Subtotal: <strong>{fmt(item.adjustmentQty * item.product.price)}</strong></div>
                </div>
                
                <select 
                  value={item.reason}
                  onChange={e => updateWorksheetItem(index, { reason: e.target.value })}
                  style={{ 
                    width: '100%',
                    padding: '10px', 
                    borderRadius: theme.radius.md, 
                    border: `1px solid ${theme.border}`, 
                    fontSize: '13px'
                  }}
                >
                  <option value="">Select reason...</option>
                  {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            )
          })}
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <TealBtn onClick={handleSave} style={{ padding: '12px 24px', fontSize: '14px' }}>
            Save Validation
          </TealBtn>
        </div>
      </>
    )}
    
    <Modal show={showSummary} onClose={() => setShowSummary(false)} title="Validation Summary">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          <div style={{ padding: '12px', borderRadius: theme.radius.md, background: theme.gray50 }}>
            <div style={{ fontSize: '12px', color: theme.gray500 }}>Products checked</div>
            <div style={{ fontSize: '24px', fontWeight: '900', color: theme.navy }}>{worksheet.length}</div>
          </div>
          <div style={{ padding: '12px', borderRadius: theme.radius.md, background: theme.gray50 }}>
            <div style={{ fontSize: '12px', color: theme.gray500 }}>Products adjusted</div>
            <div style={{ fontSize: '24px', fontWeight: '900', color: theme.navy }}>
              {worksheet.filter(w => w.adjustmentQty > 0).length}
            </div>
          </div>
          <div style={{ padding: '12px', borderRadius: theme.radius.md, background: theme.successBg }}>
            <div style={{ fontSize: '12px', color: theme.gray500 }}>Excess</div>
            <div style={{ fontSize: '24px', fontWeight: '900', color: theme.success }}>
              {worksheet.filter(w => w.direction === '+' && w.adjustmentQty > 0).length}
            </div>
          </div>
          <div style={{ padding: '12px', borderRadius: theme.radius.md, background: theme.dangerBg }}>
            <div style={{ fontSize: '12px', color: theme.gray500 }}>Shortage</div>
            <div style={{ fontSize: '24px', fontWeight: '900', color: theme.danger }}>
              {worksheet.filter(w => w.direction === '-' && w.adjustmentQty > 0).length}
            </div>
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '10px' }}>
          <GhostBtn onClick={() => setShowSummary(false)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
          <TealBtn onClick={confirmSave} style={{ flex: 1, padding: '12px' }}>
            {saving ? 'Saving...' : 'Save Validation'}
          </TealBtn>
        </div>
      </div>
    </Modal>
    
    <Toast msg={toastMsg} type={toastType} />
  </>
)
```

- [ ] **Step 6: Test Stock Validation manually**

- Navigate to Stock Management → Stock Validation tab
- Search for a product and add it to worksheet
- Try adding the same product again — verify duplicate warning
- Adjust quantity and verify subtotal updates
- Select a reason
- Click "Save Validation" — verify summary modal
- Confirm save — verify success toast and worksheet clears
- Check Inventory tab — verify stock updated
- Check Stock History tab — verify session appears (once implemented)

- [ ] **Step 7: Commit Stock Validation**

```bash
git add src/modules/stock-management/StockValidation.jsx
git commit -m "feat: add Stock Validation worksheet

- Product search and category filter
- Duplicate prevention with scroll-to-row
- Adjustment controls (+/- quantity, direction)
- Reason selection
- Validation summary before save
- Atomic save via RPC"
```

---

## Task 7: Stock History List

**Files:**
- Create: `src/modules/stock-management/StockHistory.jsx`

**Interfaces:**
- Consumes: `stockValidationRepository`
- Produces: Session list view, drill-down to detail

- [ ] **Step 1: Create StockHistory component with list view**

```jsx
// src/modules/stock-management/StockHistory.jsx
import { useState, useEffect } from 'react'
import { History, ArrowLeft } from 'lucide-react'
import { stockValidationRepository } from './repositories'
import { theme } from '../../styles/theme'
import { DataTable, Pill, Empty } from '../../components/ui'

export default function StockHistory({ brand }) {
  const [sessions, setSessions] = useState([])
  const [selectedSession, setSelectedSession] = useState(null)
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    if (!brand?.id) return
    loadSessions()
  }, [brand?.id])
  
  async function loadSessions() {
    setLoading(true)
    try {
      const data = await stockValidationRepository.getSessions(brand.id)
      setSessions(data || [])
    } catch (error) {
      console.error('loadSessions error:', error)
    }
    setLoading(false)
  }
  
  async function handleSessionClick(session) {
    try {
      const detail = await stockValidationRepository.getSessionById(session.id, brand.id)
      setSelectedSession(detail)
    } catch (error) {
      console.error('handleSessionClick error:', error)
    }
  }
  
  if (selectedSession) {
    return <SessionDetail session={selectedSession} onBack={() => setSelectedSession(null)} />
  }
  
  return (
    <>
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '20px', fontWeight: '900', color: theme.navy }}>Stock History</div>
        <div style={{ fontSize: '13px', color: theme.gray500, marginTop: '3px' }}>
          Completed validation sessions
        </div>
      </div>
      
      {sessions.length === 0 ? (
        <Empty 
          icon={<History size={80} />}
          message="No validation sessions yet. Complete your first stock validation to see history here."
        />
      ) : (
        <DataTable
          rows={sessions}
          loading={loading}
          columns={[
            { 
              key: 'created_at', 
              label: 'Date', 
              sortable: true,
              render: s => new Date(s.created_at).toLocaleString('en-NG', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })
            },
            { 
              key: 'user_name', 
              label: 'User', 
              render: s => s.user_name 
            },
            { 
              key: 'products_checked', 
              label: 'Checked', 
              align: 'right',
              render: s => s.products_checked 
            },
            { 
              key: 'products_adjusted', 
              label: 'Adjusted', 
              align: 'right',
              render: s => s.products_adjusted 
            },
            { 
              key: 'status', 
              label: 'Status', 
              render: s => <Pill label={s.status} type="green" />
            }
          ]}
          actions={s => (
            <button 
              onClick={() => handleSessionClick(s)}
              style={{ 
                padding: '5px 10px', 
                borderRadius: theme.radius.sm, 
                border: 'none', 
                background: theme.tealDeep, 
                color: 'white', 
                fontWeight: '700', 
                fontSize: '11px', 
                cursor: 'pointer' 
              }}
            >
              View Details
            </button>
          )}
        />
      )}
    </>
  )
}

function SessionDetail({ session, onBack }) {
  return (
    <>
      <button 
        onClick={onBack}
        style={{ 
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 12px',
          borderRadius: theme.radius.md,
          border: `1px solid ${theme.border}`,
          background: 'white',
          color: theme.gray600,
          fontWeight: '700',
          fontSize: '13px',
          cursor: 'pointer',
          marginBottom: '20px'
        }}
      >
        <ArrowLeft size={16} />
        Back to History
      </button>
      
      <div style={{ padding: '16px', borderRadius: theme.radius.lg, border: `1px solid ${theme.border}`, background: 'white', marginBottom: '20px' }}>
        <div style={{ fontSize: '18px', fontWeight: '900', color: theme.navy, marginBottom: '12px' }}>
          Session Details
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '12px', color: theme.gray500 }}>Date</div>
            <div style={{ fontSize: '14px', fontWeight: '700', color: theme.navy }}>
              {new Date(session.created_at).toLocaleString('en-NG')}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: theme.gray500 }}>User</div>
            <div style={{ fontSize: '14px', fontWeight: '700', color: theme.navy }}>{session.user_name}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: theme.gray500 }}>Products Checked</div>
            <div style={{ fontSize: '14px', fontWeight: '700', color: theme.navy }}>{session.products_checked}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: theme.gray500 }}>Products Adjusted</div>
            <div style={{ fontSize: '14px', fontWeight: '700', color: theme.navy }}>{session.products_adjusted}</div>
          </div>
        </div>
      </div>
      
      <DataTable
        rows={session.items || []}
        columns={[
          { 
            key: 'product_name', 
            label: 'Product',
            render: i => (
              <>
                <div style={{ fontWeight: '700', fontSize: '13px', color: theme.navy }}>{i.product_name}</div>
                {i.shelf_label && (
                  <div style={{ fontSize: '12px', color: theme.gray500 }}>Shelf: {i.shelf_label}</div>
                )}
              </>
            )
          },
          { 
            key: 'previous_stock', 
            label: 'Previous', 
            align: 'right',
            render: i => i.previous_stock 
          },
          { 
            key: 'adjustment', 
            label: 'Adjustment', 
            align: 'right',
            render: i => (
              <span style={{ 
                fontWeight: '700',
                color: i.adjustment_direction === '+' ? theme.success : theme.danger
              }}>
                {i.adjustment_direction}{i.adjustment_qty}
              </span>
            )
          },
          { 
            key: 'new_stock', 
            label: 'New', 
            align: 'right',
            render: i => i.new_stock 
          },
          { 
            key: 'reason', 
            label: 'Reason',
            render: i => i.reason || '—'
          },
          { 
            key: 'unit_price', 
            label: 'Unit Price', 
            align: 'right',
            render: i => {
              const fmt = (n) => '₦' + Number(n || 0).toLocaleString()
              return fmt(i.unit_price)
            }
          }
        ]}
      />
    </>
  )
}
```

- [ ] **Step 2: Test Stock History manually**

- Navigate to Stock Management → Stock History tab
- Verify empty state shows if no sessions exist
- After completing a validation, verify session appears in list
- Click "View Details" — verify detail view shows all product changes
- Click "Back to History" — verify return to list

- [ ] **Step 3: Commit Stock History**

```bash
git add src/modules/stock-management/StockHistory.jsx
git commit -m "feat: add Stock History list and detail view

- Session list with date, user, counts
- Drill-down to session detail
- Product-level changes table
- Read-only audit trail"
```

---

## Task 8: Final Integration & Testing

**Files:**
- None (integration testing only)

**Interfaces:**
- N/A

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass

- [ ] **Step 2: Manual end-to-end test**

1. Navigate to Stock Management
2. Verify sidebar shows "Stock Management" (not "Inventory")
3. Verify default tab is Inventory
4. Verify Inventory functionality unchanged
5. Switch to Stock Validation tab
6. Add products via search
7. Add products via category
8. Verify duplicate prevention
9. Adjust quantities and select reasons
10. Save validation
11. Verify Inventory reflects updated stock
12. Switch to Stock History tab
13. Verify session appears
14. View session details
15. Verify all product changes recorded correctly

- [ ] **Step 3: Test across business types**

If possible, test with different business types (pharmacy, skincare, etc.) to verify no pharmacy-specific logic.

- [ ] **Step 4: Test responsive design**

- Desktop: verify full-width layout
- Tablet: verify stacked layout
- Mobile: verify tap targets are large enough

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat: Stock Management complete

- Renamed Inventory to Stock Management in sidebar
- Added 3-tab module: Inventory | Stock Validation | Stock History
- Stock Validation: physical stock-taking worksheet with duplicate prevention
- Stock History: read-only audit trail of completed validations
- Shelf Label: new product attribute for physical location tracking
- Atomic save via Postgres RPC
- RLS policies matching products table pattern
- Applies to all business types"
```

---

## Summary

This plan implements the Stock Management redesign in 8 tasks:

1. **Database Schema** — tables, RPC function, RLS policies
2. **Repository** — data access layer with tests
3. **Navigation Rename** — sidebar label change
4. **Tab Shell** — 3-tab module wrapper
5. **Shelf Label** — product attribute in Inventory
6. **Stock Validation** — worksheet with duplicate prevention
7. **Stock History** — list + detail view
8. **Integration** — end-to-end testing

Each task is bite-sized with TDD steps and produces a working, testable increment.
