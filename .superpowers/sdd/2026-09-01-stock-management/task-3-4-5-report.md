# Tasks 3, 4, 5 — Stock Management Tab Shell, Nav Rename, Shelf Label

## Status: DONE

## Commits Created
- `feat: add Stock Management tab shell, rename nav, add shelf label`

## Files Changed
| File | Change |
|------|--------|
| `apps/carehub/src/lib/permissions.js` | Renamed nav label `Inventory` → `Stock Management` |
| `apps/carehub/src/modules/stock-management/StockManagement.jsx` | New tab shell component (Inventory / Stock Validation / Stock History) |
| `apps/carehub/src/modules/stock-management/StockValidation.jsx` | New placeholder component |
| `apps/carehub/src/modules/stock-management/StockHistory.jsx` | New placeholder component |
| `apps/carehub/src/pages/dashboard/BusinessDashboard.jsx` | Added StockManagement import; replaced Inventory route with StockManagement wrapper; updated TopBar title |
| `apps/carehub/src/modules/inventory/Inventory.jsx` | Added `shelf_label` to productData in saveProduct; added Shelf column to DataTable; added Shelf Label input to ProductModal |

## Concerns
None. All changes are mechanical and follow the spec exactly.
