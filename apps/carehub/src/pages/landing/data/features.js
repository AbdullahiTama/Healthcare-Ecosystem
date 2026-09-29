import {
  ShoppingCart,
  Package,
  ChartColumn,
  Users,
  Search,
  MapPin,
  Stethoscope,
  RefreshCw,
} from 'lucide-react'

// Feature bento content.
//
// `primary` marks the single visually dominant tile (Smart POS) — the brief
// asks for one dominant feature, not two equal ones as the current page has.
//
// `dc` / `dr` are explicit 6-column grid placements at >=1024px, per the spec:
// Smart POS dominates at 3x2, Inventory runs 3x1 alongside it, and the six
// secondary tiles fill the two rows beneath. They are written out rather than
// left to auto-placement so the bento resolves to the same composition every
// render.
//
// Every tile carries real body copy. The current page's six secondary tiles
// are icon + label with no description, which is why they say nothing.
export const FEATURES = [
  {
    id: 'pos',
    icon: ShoppingCart,
    title: 'Smart POS',
    primary: true,
    dc: '1 / 4',
    dr: '1 / 3',
    body: 'Ring up a sale, split the payment across methods, hold the cart for a customer coming back, and print the receipt. Stock comes off the shelf the moment the sale completes.',
  },
  {
    id: 'inventory',
    icon: Package,
    title: 'Inventory',
    dc: '4 / 7',
    dr: '1 / 2',
    body: 'Stock levels, cost prices, reorder points and product movement — across every location you run, with the low-stock list telling you what to reorder and when.',
    embed: 'stock',
  },
  {
    id: 'reports',
    icon: ChartColumn,
    title: 'Financial reports',
    dc: '1 / 2',
    dr: '3 / 4',
    body: 'Sales, expenses, purchases and VAT, with exports.',
  },
  {
    id: 'staff',
    icon: Users,
    title: 'Staff & roles',
    dc: '2 / 3',
    dr: '3 / 4',
    body: 'Eight built-in roles plus your own, with permissions per person.',
  },
  {
    id: 'carefind',
    icon: Search,
    title: 'CareFind',
    dc: '3 / 4',
    dr: '3 / 4',
    body: 'Your business, services and eligible products, discoverable.',
  },
  {
    id: 'locations',
    icon: MapPin,
    title: 'Multi-location',
    dc: '4 / 5',
    dr: '3 / 4',
    body: 'Centralised stock, staff and reporting across branches.',
  },
  {
    id: 'workflow',
    icon: Stethoscope,
    title: 'Healthcare workflow',
    dc: '5 / 6',
    dr: '3 / 4',
    body: 'Reception, triage, consultation, lab, imaging and pharmacy as one chain.',
  },
  {
    id: 'connection',
    icon: RefreshCw,
    title: 'Connection status',
    dc: '6 / 7',
    dr: '3 / 4',
    body: 'Staff can see at a glance whether the dashboard is online, offline or syncing.',
  },
]

// Sample rows for the Inventory tile's embedded stock list.
//
// These are illustrative marketing placeholders, not customer data. The status
// split follows the real rule in modules/dashboard-home/DashboardHome.jsx:65-66
// (low = stock > 0 && stock <= reorder_level; out = stock <= 0) so the demo
// does not teach a rule the product does not use.
export const STOCK_ROWS = [
  { label: 'Paracetamol 500mg', detail: 'In stock · 342 units', pct: 85, status: 'In stock' },
  { label: 'Amoxicillin 250mg', detail: 'Low stock · 12 units', pct: 18, status: 'Low stock' },
  { label: 'Vitamin C 1000mg', detail: 'In stock · 128 units', pct: 67, status: 'In stock' },
]
