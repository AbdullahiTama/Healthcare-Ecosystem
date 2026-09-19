# CareHub Premium Value Upgrade — Prioritized Task List

Source: `brainstorm-carehub-premium-upgrade-2026-08-19` (memlog + intent). Unlock order respected: **1) FEFO + expired-batch block → 2) HMO/NHIS claims → 3) owner digest** lead P0.

---

## P0 — Ship Next

### Expiry safety (unlock #1 — group)
- [ ] FEFO picking: POS defaults to selling nearest-expiry batch first. *(small)*
- [ ] Hard-block expired-batch sales at POS; licensed-staff override with audit log entry. *(small)*
- [ ] Expiry alert dashboard: 30/15/7/0-day horizons per warehouse, with expected loss value. *(medium)*
- [ ] Batch-level expiry capture at GRN + FEFO label printing (enhance purchases). *(medium)*
- [ ] Dead-stock handling: auto markdown/promotion suggestions (bundle, discount, donation write-off) + supplier returns workflow. *(medium)*

### Cash recovery (unlock #2 — group)
- [ ] HMO/NHIS claims engine: capture scheme + policy at sale, submit, track approval/denial/reimbursement. *(large)*
- [ ] Claims status dashboard for scheme/HMO balances, pending vs approved vs reimbursed. *(medium)*

### Owner digest (unlock #3 — group)
- [ ] Scheduled owner digest via email/WhatsApp: daily plain-language P&L per location + "what needs attention today" (expiring stock, overdue debts, unpaid invoices) — push insights, not charts. *(medium)*
- [ ] Dashboard rework: "what needs attention today" default view over static charts. *(medium)*

### Compliance & trust (P0 extension of unlock #1)
- [ ] NAFDAC/PCN compliance pack: controlled-drugs register (Sched I–IV) + narcotic log. *(large)*
- [ ] One-click compliance report bundle (NAFDAC, PCN, tax, VAT) + audit-ready exports. *(medium)*
- [ ] Audit-log viewer in Settings + signed, regulatory-grade audit trail export accepted by NAFDAC/PCN inspectors. *(medium)*

---

## P1 — This Quarter

### Debt recovery & cashier integrity
- [ ] Automatic debt dunning: WhatsApp/email/SMS reminders + Paystack collection links + payment tracking. *(large)*
- [ ] Debtor credit scoring + polite automated reminders with payment links. *(medium)*
- [ ] Cashier integrity: granular permissions, full shift audit log, shift reconciliation. *(medium)*
- [ ] Shrinkage variance reports: theoretical vs actual stock, cashier variance, expiry losses. *(medium)*
- [ ] Supplier payables aging + scheduled payouts from purchases. *(medium)*

### Purchasing & inventory intelligence
- [ ] Purchase-order workflow: PO → supplier → GRN auto-matching against PO and invoice. *(medium)*
- [ ] Supplier ledger: per-supplier accounts, returns/credit notes, order history, payment status. *(medium)*
- [ ] Automated reorder suggestions from stock level + demand velocity + supplier lead time. *(medium)*
- [ ] Units of measure: stock by box/pack, sell by tablet/unit with auto-conversion at POS. *(large)*
- [ ] Demand forecasting + safety-stock warnings before shortages. *(medium)*
- [ ] Cycle counting via barcode + reconciliation mode (removes manual stock count). *(medium)*

### POS friction & resilience
- [ ] Offline-first read/write PWA with smart conflict-free sync; offline queue never blocks sales. *(large)*
- [ ] Digital receipts + Paystack/bank-transfer e-wallet payments (end paper dependency). *(medium)*
- [ ] Frictionless checkout: scan → pay → go; quick-dispense mode. *(medium)*
- [ ] Faster service: queue-aware triage + self-checkout kiosk mode. *(medium)*

### Growth & retention
- [ ] Loyalty points on payment, redeemable at POS + recall lists. *(medium)*
- [ ] Diagnosis-driven companion-item suggestions (test → recommended meds/supplements). *(small)*
- [ ] Referral bonus redeemable against own debt/credit. *(small)*
- [ ] CareFind as inbound lead engine: search → book → consult → visit. *(medium)*
- [ ] CareFind self-serve booking + Paystack prepay + queue number (skip the queue). *(medium)*
- [ ] Partner/network revenue share built on the referral-agent commission flow. *(medium)*

### Clinical depth (staged)
- [ ] E-prescription with QR the patient scans at any CareHub pharmacy; printable prescriptions. *(medium)*
- [ ] Structured SOAP notes, uploads, printable prescriptions (enhance consultations). *(medium)*
- [ ] Post-visit care plans, refill reminders, follow-up scheduling (continuous care). *(medium)*
- [ ] Care bundles: consult + lab order + pharmacy dispensing in one patient-centered flow. *(medium)*

### Onboarding & support
- [ ] Guided setup wizard, import templates, 15-minute "first sale" flow. *(medium)*
- [ ] Interactive guided tour, sandbox demo data, staff certification. *(medium)*
- [ ] In-app help center, contextual tips, chatbot, customer-success checklist. *(medium)*
- [ ] Lean Lite tier: flat low price, core POS+inventory+expiry; module add-ons a la carte; single clear pricing page. *(small)*

### Reporting & branch ops
- [ ] Interactive drill-down reports (filters, rollups) instead of static views; period-over-period comparison; Excel/PDF export. *(medium)*
- [ ] Scheduled report digests (email/WhatsApp). *(small)*
- [ ] Branches as one business: central purchasing, cross-branch transfers with approval, consolidated reports. *(large)*
- [ ] One-click branch duplication + per-business-type templates. *(medium)*
- [ ] Multi-entity holding: one login, many companies, consolidated group P&L. *(medium)*

---

## P2 — Next Quarter

### Clinical depth (continued)
- [ ] Full inpatient module: admissions, beds/wards, nursing tasks, discharge (win hospital customers). *(large)*
- [ ] Unified patient timeline across pharmacy/hospital/lab/imaging. *(large)*
- [ ] Consent-based client health profiles: allergies, blood group, chronic conditions. *(medium)*
- [ ] Lab results auto-pushed to patient phone via WhatsApp/email with PDF + doctor's explanation. *(medium)*
- [ ] Appointments: multi-staff scheduling, recurring, no-show automation; WhatsApp booking via chat + automated reminders. *(medium)*

### Reporting & operations (continued)
- [ ] Daily plain-language profit & loss per location ("did I make money today"). *(medium)*
- [ ] Cashflow calendar unifying debts, expenses, purchases, sales. *(medium)*
- [ ] Auto bank/cash-drawer reconciliation removes manual cash work. *(medium)*
- [ ] Proactive anomaly alerts on live activity wall (sales drop vs same hour last week); price-change, discount, low-stock anomalies. *(medium)*
- [ ] Staff performance metrics: sales per staff, attendance, shrinkage attribution. *(medium)*
- [ ] Shift scheduling + attendance with PIN and payroll-ready hours. *(medium)*
- [ ] Barcode scanning reused for staff attendance and asset tracking. *(small)*

### Compliance, catalog & misc
- [ ] Proactive compliance checklist + NAFDAC drug-recall feed alerts. *(medium)*
- [ ] Master catalog enrichment: therapeutic classes, generics, drug-interaction warnings. *(large)*
- [ ] Per-clinic formularies and price lists from master catalog. *(medium)*
- [ ] Native tax invoices with e-invoice QR; auto tax classification + VAT-ready expense reports. *(medium)*
- [ ] Expenses: photo receipt upload + category budgets. *(small)*
- [ ] Billing: split payments, partial payments, deposit + balance workflow. *(medium)*
- [ ] ADR reports: national reporting export + follow-up status tracking. *(small)*
- [ ] Passwordless OTP login, quick role-switching, 2FA, session management. *(medium)*
- [ ] Role-based access + read-only + per-staff activity timeline. *(medium)*
- [ ] Automatic backups, point-in-time recovery, export-anytime. *(medium)*
- [ ] Role-split apps: owner metrics app, cashier POS app, doctor clinical app. *(medium)*
- [ ] CareFind: reviews/ratings + verified "expiry-safe" pharmacy badge. *(small)*
- [ ] Appointments + consultations + referral network: inter-pharmacy prescription referral on top of referral agent. *(medium)*

---

## Moonshots (appendix — not in near-term roadmap)

- [ ] CareHub Pay: business working-capital account with instant POS settlement. *(large)*
- [ ] Embedded finance: inventory-backed micro-loans, insurance bundles, group-buying discounts. *(large)*
- [ ] Drug authenticity: anti-counterfeit batch serialization with QR verification. *(large)*
- [ ] CareHub Health ID: patient-held portable health record QR portable across providers. *(large)*
- [ ] AI back-office assistant: cash-flow prediction, PO drafting, payment reconciliation, voice Q&A. *(large)*
- [ ] Voice-first daily briefing for owners (sales up 12%, 3 items expiring, 2 debts due). *(medium)*
- [ ] Clinical decision support: drug interactions, contraindications, dosage for pharmacists. *(large)*
- [ ] Cold-chain monitoring + smart stock alerts for temperature-sensitive drugs. *(large)*
- [ ] National expiry/shortage alert network across CareHub businesses. *(medium)*
- [ ] Anonymized market-intelligence reports: pricing trends, drug demand (premium data product). *(medium)*
- [ ] Anonymized disease/demand trend reports for pharma/NGOs (data product). *(medium)*
- [ ] Competitive benchmarks: your prices vs same-area competitors. *(small)*
- [ ] Group purchasing marketplace: aggregated buying power for inventory discounts. *(large)*
- [ ] Embedded CPD/continuing professional education with points tracking. *(medium)*
- [ ] Camera-based product recognition for unbarcoded items. *(medium)*
- [ ] Voice-to-text SOAP notes and local-language speech entry for staff. *(medium)*
- [ ] Shoppable e-commerce storefront per CareHub business + delivery management; consultation → e-prescription → doorstep delivery in one click. *(large)*
- [ ] Native Android apps for POS and owner dashboards. *(large)*
- [ ] SMS-based fallback transactions for power/internet dependency. *(medium)*
- [ ] Hybrid edge deployment for low-connectivity hospitals (local-first, cloud-sync). *(large)*
- [ ] Multi-country expansion (GH, KE, ZA) with localized compliance + multi-currency; global master catalog. *(large)*
- [ ] Native bookkeeping ledger (income/expense/asset) removes multi-tool accounting. *(medium)*
- [ ] Public "care index" badges (quality/compliance scores) on CareFind business profiles. *(small)*
- [ ] Regional manager view scoped to assigned territories only; territory analytics, retention cohorts, new-customer source tracking. *(medium)*
- [ ] Drug+service packages: tests + meds + consult at one price. *(small)*
- [ ] Self-serve support + community + in-app AI help removes call-center tickets. *(medium)*
