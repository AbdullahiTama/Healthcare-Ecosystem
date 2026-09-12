# Information Architecture — HealthCare Ecosystem

**Version**: 1.0
**Principle**: Organize around user goals and workflows, not database tables

---

## 1. CareHub — Operational SaaS

### 1.1 User Roles & Primary Goals

| Role | Primary Goals | Key Modules |
|------|---------------|-------------|
| **Owner** | Business overview, revenue, compliance, growth | Dashboard, Overview, Reports, Settings, Staff |
| **Pharmacist** | Dispensing, inventory, prescriptions, patient safety | POS, Inventory, RxInbox, Consultations, Dashboard |
| **Inventory Officer** | Stock levels, reordering, supplier management | Inventory, Purchases, Demand, Warehouses, Master Catalog |
| **Cashier** | Sales, payments, customer service | POS, Clients, Payments, Dashboard |
| **Nurse/Clinician** | Patient flow, vitals, consultations | Reception, Triage, Doctor, Lab, Imaging, RxInbox |
| **Manager** | Staff schedules, branch performance, expenses | Staff, Locations, Expenses, Reports, Overview |

### 1.2 Navigation Structure (Grouped by Workflow)

```
CAREHUB
│
├── OVERVIEW
│   ├── Dashboard (role-adaptive)
│   └── Overview (multi-branch, owner only)
│
├── OPERATIONS
│   ├── POS / Sales
│   ├── Inventory
│   │   ├── Stock Levels
│   │   ├── Low Stock Alerts
│   │   ├── Expiry Tracking
│   │   └── Stock Transfers
│   ├── Purchases
│   │   ├── Purchase Orders
│   │   ├── Supplier Management
│   │   └── Requisitions
│   ├── Appointments
│   │   ├── Calendar View
│   │   ├── Booking Management
│   │   └── Waitlist
│   └── Consultations
│       ├── Queue
│       ├── History
│       └── Templates
│
├── PATIENTS & CLIENTS
│   ├── Clients / Patients
│   │   ├── Directory
│   │   ├── Profiles
│   │   ├── History
│   │   └── Communications
│   ├── Debts & Credit
│   │   ├── Outstanding
│   │   ├── Payment Plans
│   │   └── Collections
│   └── Loyalty / Subscriptions
│
├── CLINICAL (Hospital/Clinic)
│   ├── Reception
│   ├── Triage
│   ├── Doctor Consultation
│   ├── Laboratory
│   ├── Imaging / Radiology
│   └── Pharmacy (RxInbox)
│
├── FINANCE
│   ├── Sales & Revenue
│   ├── Payments & Reconciliation
│   ├── Expenses
│   ├── Debts (Owed to us)
│   └── Payouts / Withdrawals
│
├── PEOPLE
│   ├── Staff Directory
│   ├── Roles & Permissions
│   ├── Schedules & Shifts
│   ├── Performance
│   └── Payroll (future)
│
├── INTELLIGENCE
│   ├── Reports
│   │   ├── Sales Reports
│   │   ├── Inventory Reports
│   │   ├── Financial Reports
│   │   ├── Clinical Reports
│   │   └── Custom Reports
│   ├── Demand Forecasting
│   └── Analytics Dashboard
│
├── ECOSYSTEM
│   ├── CareFind Profile
│   ├── Locations / Branches
│   ├── Master Catalog
│   ├── Warehouses
│   ├── Territories
│   ├── Messages
│   ├── Stock Transfers
│   ├── Orders
│   └── Live Activity
│
└── ADMINISTRATION
    ├── Organization Settings
    ├── Subscription & Billing
    ├── Locations & Branches
    ├── Staff & Roles
    ├── POS Settings
    ├── Inventory Settings
    ├── Clinical Settings
    ├── Notification Preferences
    └── Integrations
```

### 1.3 Navigation Principles Applied

1. **Group by workflow**, not module: "Operations" contains POS, Inventory, Purchases because they're the daily operational loop
2. **Role-aware visibility**: Clinical section only shows for hospital-type businesses; Pharmacist sees RxInbox prominently
3. **Maximum 2 levels deep**: No third-level nesting
4. **Consistent labeling**: Noun-based for objects (Inventory), verb-based for actions (New Sale via POS)
5. **Badge counts** on nav items with attention needs (low stock, pending appointments, unpaid debts)

### 1.4 Page-Level IA Patterns

#### Standard Page Structure
```
Page
├── PageHeader
│   ├── Title (h1)
│   ├── Description (optional)
│   ├── Breadcrumb
│   └── PrimaryAction (TealBtn)
├── ContextBar (optional)
│   ├── Filters
│   ├── Search
│   └── View Toggles
├── MainContent
│   ├── KPI Row (if dashboard-like)
│   ├── DataTable / Card Grid / Form
│   └── Pagination / Load More
└── FooterActions (optional)
    ├── Bulk Actions
    └── Export
```

#### List Pages (Inventory, Clients, Sales)
- Default: DataTable with server-side sort/filter/paginate
- Mobile: Card list transform
- Toolbar: Search + Filter chips + View toggle + Primary action

#### Detail Pages (Client Profile, Product Detail, Sale Detail)
- DetailHeader (back + title + subtitle)
- Tabbed sections: Overview | History | Communications | Documents
- Contextual actions in header (Edit, Print, Share)

#### Form Pages (New Sale, New Client, New Purchase Order)
- SectionHead with "Cancel" + "Save" footer
- Grouped fields with clear labels
- Progressive disclosure for optional sections
- Validation on blur/submit

---

## 2. CareFind — Public Marketplace & Discovery

### 2.1 User Personas & Goals

| Persona | Goals | Key Flows |
|---------|-------|-----------|
| **Patient/Consumer** | Find nearby pharmacy, book appointment, order meds | Search → Filter → Provider Card → Book/Contact |
| **Health Professional** | Build profile, get discovered, manage bookings | Claim Profile → Setup Consultations → Manage Calendar |
| **Pharmacy Owner** | List products, manage inventory, get orders | Business Dashboard → Products → Orders → Wallet |
| **Walk-in Customer** | Quick purchase, check availability | Search → Product Card → WhatsApp/Call |

### 2.2 Navigation Structure

```
CAREFIND (Public)
│
├── DISCOVERY
│   ├── Search (unified: products, facilities, professionals)
│   │   ├── Products Tab
│   │   ├── Facilities Tab
│   │   └── Professionals Tab
│   ├── Categories
│   │   ├── Medications
│   │   ├── Wellness & Supplements
│   │   ├── Medical Equipment
│   │   ├── Personal Care
│   │   └── Baby & Maternity
│   ├── Map View (location-based)
│   └── Featured / Promotions
│
├── PROVIDER PROFILES
│   ├── Pharmacy Profile
│   │   ├── Products
│   │   ├── Info & Hours
│   │   ├── Reviews
│   │   └── Book Appointment
│   ├── Hospital / Clinic Profile
│   │   ├── Services
│   │   ├── Doctors
│   │   ├── Book Appointment
│   │   └── Reviews
│   └── Professional Profile
│       ├── Consultations
│       ├── Subscriptions
│       ├── Reviews
│       └── Book Consultation
│
├── USER ACCOUNT (Authenticated)
│   ├── Wallet & Payments
│   │   ├── Balance (CareCoins)
│   │   ├── Top Up
│   │   ├── Withdraw
│   │   └── History
│   ├── My Bookings
│   │   ├── Upcoming
│   │   ├── Past
│   │   └── Prescriptions
│   ├── Subscriptions
│   │   ├── Active
│   │   ├── Manage
│   │   └── Billing
│   ├── Profile & Settings
│   │   ├── Personal Info
│   │   ├── Notification Preferences
│   │   ├── Privacy
│   │   └── Security
│   └── Saved / Favorites
│
├── SELLER DASHBOARD (Verified Sellers)
│   ├── Products
│   │   ├── Active Listings
│   │   ├── Add Product
│   │   ├── Inventory
│   │   └── Pricing
│   ├── Orders
│   │   ├── New
│   │   ├── Processing
│   │   ├── Ready for Pickup
│   │   └── Completed
│   ├── Business Profile
│   │   ├── Info & Hours
│   │   ├── Photos
│   │   ├── Booking Settings
│   │   └── Verification
│   ├── Wallet & Earnings
│   │   ├── Balance
│   │   ├── Withdraw
│   │   └── Statements
│   └── Analytics
│       ├── Views
│       ├── Conversions
│       └── Revenue
│
└── ADMIN (Platform)
    ├── Verification Queue
    ├── Content Moderation
    ├── Promotions Management
    ├── Analytics
    └── Settings
```

### 2.3 Key User Flows

#### Patient: Find & Book
```
Search (query + location) 
  → Results (tabs: Products | Facilities | Professionals)
    → Facility Card (name, distance, rating, hours, services)
      → Profile (products, reviews, booking)
        → Book Appointment (date, time, type, payment: CareCoins/Card)
          → Confirmation → Notification to provider
```

#### Professional: Setup & Manage
```
Claim/Create Profile
  → Add Consultation Offers (type, fee, duration, medium)
  → Set Availability (slots, recurring)
  → Verify Identity
    → Live on CareFind
      → Receive Bookings
      → Manage Calendar (confirm/complete/cancel)
      → Get Paid (CareCoins → Wallet → Withdraw)
```

#### Pharmacy: List Products
```
Business Dashboard
  → Add Product (name, category, price, stock, images)
  → Set Sale Type (Retail/Wholesale/Distributor)
  → Set Min Purchase
  → Publish
    → Appears in Search & Map
      → Receive Orders (WhatsApp/Call)
      → Update Stock
      → Get Paid (Wallet)
```

---

## 3. Cross-App Navigation & Context Switching

### 3.1 CareHub → CareFind
- **From CareHub**: "CareFind Profile" nav item → opens CareFind business profile in new tab
- **Context**: Pre-authenticated via shared session (SSO)
- **Purpose**: Owner manages public presence from operational hub

### 3.2 CareFind → CareHub
- **From CareFind Seller Dashboard**: "Open CareHub" → opens CareHub dashboard
- **Context**: Verified sellers get CareHub account automatically
- **Purpose**: Seller manages operations (inventory, POS) from CareHub

### 3.3 Shared Entities (Single Source of Truth)

| Entity | System of Record | Sync Direction |
|--------|------------------|----------------|
| Business/Pharmacy | CareHub | CareHub → CareFind (profile, products, hours, booking config) |
| Products | CareHub (Inventory) | CareHub → CareFind (listings, stock, pricing) |
| Appointments | CareFind (bookings) | CareFind → CareHub (notifications, calendar) |
| Users/Patients | CareFind (consumers) | CareFind → CareHub (client creation on first sale) |
| Wallet/CareCoins | CareFind | CareFind only (consumer wallet) |
| Business Wallet | CareHub | CareHub only (payouts, commissions) |

---

## 4. Search & Discovery Architecture

### 4.1 Search Entry Points

| Entry Point | Scope | Filters |
|-------------|-------|---------|
| Global Search (CareFind header) | Products + Facilities + Professionals | Category, Location, Rating, Price, Availability |
| Category Browse | Products only | Sub-category, Brand, Price Range, In Stock |
| Map View | Facilities only | Type, Hours Open, Services, Rating |
| Professional Directory | Professionals only | Specialty, Location, Consultation Type, Fee Range |
| CareHub Internal Search | Clients, Products, Sales, Staff | Module-specific |

### 4.2 Ranking Signals

1. **Relevance** (text match: name > generic > category > description)
2. **Distance** (if location provided: nearest first)
3. **Availability** (in stock / open now / has open slots)
4. **Quality** (rating, review count, verification badge)
5. **Recency** (newly added / recently updated)
6. **Promotion** (paid featured listings — labeled)

---

## 5. Notification & Communication IA

### 5.1 Notification Categories

| Category | Channels | Examples |
|----------|----------|----------|
| **Urgent/Action Required** | In-app + Push + SMS | Low stock critical, appointment conflict, payment failed |
| **Operational** | In-app + Email | New order, appointment booked, stock reorder needed |
| **Informational** | In-app | Report ready, promotion expiring, weekly summary |
| **Marketing** | Email + Push (opt-in) | New features, health tips, seasonal promotions |

### 5.2 Notification Center (CareHub)
- Bell icon in TopBar with unread count
- Dropdown: grouped by date, mark all read, filter by type
- Full page: searchable, filterable, bulk actions

### 5.3 Notification Center (CareFind)
- Bell icon in header (authenticated)
- Mobile: BottomNav badge + in-app center
- Types: Booking updates, order status, wallet activity, reviews

---

## 6. Settings & Configuration IA

### 6.1 CareHub Settings (Grouped)

```
SETTINGS
├── Business Profile
│   ├── Name, Logo, Cover
│   ├── Contact Info
│   ├── Hours
│   ├── Address & GPS
│   └── Description
├── POS & Sales
│   ├── Payment Methods
│   ├── Receipt Template
│   ├── Tax Configuration
│   └── Discount Rules
├── Inventory
│   ├── Categories
│   ├── Reorder Levels
│   ├── Units of Measure
│   └── Expiry Alerts
├── Clinical
│   ├── Consultation Types
│   ├── Vital Signs Templates
│   ├── Prescription Templates
│   └── Referral Network
├── Booking (CareFind Sync)
│   ├── Enable/Disable
│   ├── Slot Configuration
│   ├── Fees (Online/Physical)
│   └── Consultation Medium
├── Staff & Roles
│   ├── Staff Directory
│   ├── Role Definitions
│   ├── Custom Roles
│   └── Permissions Matrix
├── Locations
│   ├── Branches
│   ├── Warehouses
│   └── Territories
├── Notifications
│   ├── Channels (In-app, Email, SMS, Push)
│   ├── Triggers
│   └── Templates
├── Subscription
│   ├── Plan Details
│   ├── Billing History
│   ├── Upgrade/Downgrade
│   └── Payment Method
└── Integrations
    ├── Paystack
    ├── Accounting (future)
    ├── WhatsApp Business
    └── API Keys
```

### 6.2 CareFind Settings (Simpler)

```
SETTINGS
├── Account
│   ├── Profile (name, avatar, bio)
│   ├── Email & Phone
│   ├── Password & Security
│   └── Two-Factor Auth
├── Notifications
│   ├── Booking Updates
│   ├── Order Updates
│   ├── Wallet Activity
│   ├── Reviews & Ratings
│   └── Marketing (opt-in)
├── Privacy
│   ├── Profile Visibility
│   ├── Data Sharing
│   └── Delete Account
├── Wallet
│   ├── Auto Top-Up
│   ├── Default Payment Method
│   └── Withdrawal PIN
└── Seller (if verified)
    ├── Business Profile
    ├── Booking Settings
    ├── Payout Settings
    └── Verification Status
```

---

## 7. Responsive IA Adaptations

| Component | Desktop (≥1024) | Tablet (768-1023) | Mobile (<768) |
|-----------|-----------------|-------------------|---------------|
| **Sidebar** | Full (210px) | Icon rail (64px) | Drawer (240px) |
| **Header** | Full + actions | Condensed + actions | Compact + hamburger |
| **DataTable** | Full table | Table + horiz scroll | Card list |
| **Cards** | Multi-column grid | 2-column grid | Single column |
| **Forms** | 2-column groups | 1-2 column | Single column |
| **Modals** | Centered (500-700px) | Centered (90vw) | Sheet (bottom) |
| **BottomNav** | Hidden | Hidden | Visible (5 items) |
| **Right Sidebar** | Beside main | Below main | Hidden (drawer) |

---

## 8. Deep Linking & URL Structure

### 8.1 CareHub Routes
```
/dashboard                    → Dashboard (role-adaptive)
/dashboard/overview           → Multi-branch overview (owner)
/dashboard/pos                → POS / New Sale
/dashboard/inventory          → Inventory List
/dashboard/inventory/:id      → Product Detail
/dashboard/clients            → Client List
/dashboard/clients/:id        → Client Profile
/dashboard/appointments       → Appointments Calendar
/dashboard/appointments/:id   → Appointment Detail
/dashboard/consultation       → Consultation Queue
/dashboard/expenses           → Expenses
/dashboard/debts              → Debts & Credit
/dashboard/purchases          → Purchase Orders
/dashboard/staff              → Staff Directory
/dashboard/reports            → Reports Dashboard
/dashboard/reports/:type      → Specific Report
/dashboard/settings           → Settings (tabbed)
/dashboard/carefind           → CareFind Profile
```

### 8.2 CareFind Routes
```
/                           → Search (home)
/search                     → Search Results
/search?q=...&tab=products  → Deep-linked search
/drug/:name                 → Product Detail
/business/:id               → Facility Profile
/business/:id/products      → Facility Products
/business/:id/reviews       → Facility Reviews
/u/:id                      → Professional Profile
/u/:id/consultations        → Professional Consultations
/wallet                     → Wallet Dashboard
/wallet/topup               → Top Up Flow
/wallet/withdraw            → Withdraw Flow
/bookings                   → My Bookings
/subscriptions              → My Subscriptions
/profile                    → User Profile
/seller                     → Seller Dashboard
/seller/products            → Seller Products
/seller/orders              → Seller Orders
/seller/analytics           → Seller Analytics
```

---

## 9. Future IA Considerations

### 9.1 Planned Expansions
- **Telemedicine**: Video consultation rooms, waiting rooms, recording
- **Lab Marketplace**: Order tests, receive results, share with doctors
- **Insurance Claims**: Submit, track, adjudicate
- **Multi-tenant**: Hospital networks, pharmacy chains
- **API/Developer Portal**: Third-party integrations

### 9.2 IA Scalability Rules
- New modules → fit into existing workflow groups
- New roles → inherit from base permissions, override minimally
- Deep linking → every entity addressable
- Search → unified index across all entity types