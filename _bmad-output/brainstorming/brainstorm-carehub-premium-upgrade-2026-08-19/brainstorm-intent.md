# CareHub Premium Value Upgrade — Intent

## Context

- **Product:** CareHub — healthcare OS for Nigerian pharmacies, hospitals, labs, and imaging centers. POS, batch/expiry inventory, purchases, stock/warehouses, debts, clients, appointments, hospital pipeline, consultations, ADR reports, referral agent, master catalog, staff/roles, reports hub, CareFind marketplace, Paystack wallets.
- **Market:** Nigeria (NG pharmacy competitors 8k–80k NGN/mo: ClinikEHR, InkeepX, Tracepos, PharmaPro, MedPoint, QuickPharm, RxManager, NigeriaPharm Pro, SmartPharmacy, PharmaSoft). Global benchmarks: Zoho Health, Practo Ray, HMSi360/HospitalOS, Cliniko, Kareo/Tebra, Althea.
- **Pricing:** ₦10k / ₦25k / ₦35k / ₦60k per month; premium diff must justify top tiers vs cheap competitors.
- **Recommended unlock order:** 1) FEFO + expired-batch block (expiry capture already built), 2) HMO/NHIS claims engine, 3) owner digest.

## Trust & Compliance (near-term — the #1 unlock)

- **FEFO picking:** POS defaults to selling nearest-expiry batch first. *(idea: FEFO picking)*
- **Hard-block expired-batch sales at POS**, with licensed-staff override + audit log. *(idea: hard-block expired-batch sales; also `regulatory-grade signed audit trail export accepted by NAFDAC/PCN inspectors`)*
- **Expiry alert dashboard:** 30/15/7/0-day horizons per warehouse, with expected loss value. *(idea: expiry alert dashboard)*
- **NAFDAC/PCN compliance pack:** controlled-drugs register (Sched I–IV), narcotic log, one-click compliance report bundle (NAFDAC, PCN, tax, VAT), audit-ready exports. *(ideas: NAFDAC/PCN compliance pack; one-click compliance report bundle)*
- **Dead-stock handling:** auto markdown/promotion suggestions (bundle, discount, donation write-off) + supplier returns workflow. *(ideas: auto markdown; auto markdown engine + supplier returns)*

## Cash Recovery (near-term)

- **HMO/NHIS claims engine (unlock #2):** capture scheme+policy at sale, submit, track approval/denial/reimbursement. *(idea: HMO/NHIS claims engine)*
- **Automatic debt dunning:** WhatsApp/email/SMS reminders + Paystack collection links + payment tracking; debtor credit scoring with polite reminders. *(ideas: recover debt automatically; debtor credit scoring)*
- **Supplier payables aging + scheduled payouts** from purchases. *(idea: supplier payables aging)*
- **Shift/cash integrity:** granular permissions, full shift audit log, shift reconciliation, cashier variance vs theoretical stock. *(ideas: keep cashiers honest; cut shrinkage)*
- **[MOONSHOT] Embedded finance:** inventory-backed micro-loans, insurance bundles, group-buying discounts. *(idea: embedded finance)*

## Growth & Network (near-term core + selected moonshots)

- **CareFind as inbound lead engine:** search → book → consult → visit; self-serve booking + Paystack prepay + queue number. *(ideas: CareFind inbound leads; self-serve booking)*
- **Network monetization:** partner/network revenue share on referral-agent commission flow; inter-pharmacy prescription referral network. *(ideas: network revenue share; referral network)*
- **E-commerce storefront per CareHub business + delivery management;** consultation → e-prescription → doorstep delivery in one click. *(ideas: shoppable storefront; delivery coordination)*
- **Loyalty & retention:** loyalty points redeemable at POS, recall lists, referral bonus redeemable against own debt. *(ideas: make patients return; referral bonus vs debt)*
- **Market data product [MOONSHOT]:** anonymized pricing/demand/trend intelligence reports (care index badges, competitive price benchmarks). *(ideas: market-intelligence reports; competitive benchmarks; care index badges)*

## Clinical Depth (near-term, staged)

- **E-prescription with QR** the patient scans at any CareHub pharmacy; printable prescriptions; post-visit care plans, refill reminders, follow-up scheduling. *(ideas: e-prescription QR; continuous care)*
- **Full inpatient module** to win hospital customers: admissions, beds/wards, nursing tasks, discharge. *(idea: win hospital customers)*
- **Unified patient timeline** across pharmacy/hospital/lab/imaging; consent-based health profiles (allergies, blood group, chronic conditions). *(ideas: hub of patient journey; health profiles)*
- **Lab results auto-pushed to patient** via WhatsApp/email with PDF + doctor's explanation. *(idea: lab results auto-push)*
- **Structured SOAP notes**, uploads, care bundles (consult + lab + dispensing in one flow). *(ideas: consultations SOAP; care bundles)*
- **Clinical decision support [MOONSHOT]:** drug interactions, contraindications, dosage for pharmacists; enriched master catalog (therapeutic classes, generics). *(ideas: clinical decision support; catalog enrichment)*

## Quick Wins (near-term, low-cost, high-perceived-value)

- **Owner digest (unlock #3):** daily plain-language P&L per location + "what needs attention today" (expiring stock, overdue debts, unpaid invoices) via email/WhatsApp; push-not-style alerts, not charts. *(ideas: owner digest; dashboard = what needs attention; push insights)*
- **Onboarding:** guided setup wizard, import templates, 15-minute "first sale" flow, sandbox demo data. *(ideas: instant onboarding; interactive guided tour)*
- **POS friction + resilience:** offline-first read/write PWA with smart conflict-free sync; units of measure with auto-conversion; digital receipts; e-wallet/Paystack payments. *(ideas: offline PWA; units of measure; digital receipts)*
- **Purchasing:** PO → supplier → GRN auto-matching, supplier ledger (returns/credit notes/history), auto-reorder from demand velocity + lead time. *(ideas: PO workflow; supplier ledger; auto reorder)*
- **Reports:** interactive drill-down (filters/rollups), period-over-period, scheduled digests, Excel/PDF export. *(ideas: drill-down reports; scheduled digests)*
- **Branch/entity ops:** one-click branch duplication, central inventory + transfer workflow, consolidated multi-branch/group reports, per-clinic formularies. *(ideas: branches as one business; central inventory; multi-entity holding)*
- **Selling more per visit:** diagnosis-driven companion-item suggestions (test → recommended meds/supplements). *(idea: sell more per visit)*
- **Lean Lite tier:** flat low price, core POS+inventory+expiry; module add-ons a la carte; single clear pricing page. *(ideas: Lean Lite tier; clear pricing page)*
- **Support enablement:** self-serve help, in-app contextual tips/chatbot, customer-success checklist; role-split apps (owner/cashier/doctor). *(ideas: help center; role-split apps)*

## Moonshots (not in near-term roadmap)

- **CareHub Pay:** business working-capital account with instant POS settlement. *(idea: CareHub Pay)*
- **Drug authenticity:** anti-counterfeit batch serialization with QR verification. *(idea: drug authenticity)*
- **CareHub Health ID:** patient-held portable health record QR portable across providers. *(idea: CareHub Health ID)*
- **AI back-office assistant:** cash-flow prediction, PO drafting, payment reconciliation, voice Q&A; voice-first daily owner briefing. *(ideas: AI assistant; voice-first briefing)*
- **Cold-chain monitoring** + smart stock alerts for temperature-sensitive drugs; national expiry/shortage alert network across CareHub businesses. *(ideas: cold-chain; national alert network)*
- **Voice-to-text SOAP notes** and local-language speech entry. *(idea: voice-to-text SOAP)*
- **Multi-country expansion** (GH, KE, ZA) with localized compliance + multi-currency; global master catalog. *(ideas: multi-country; global catalog)*
- **Hybrid edge deployment** for low-connectivity hospitals (local-first, cloud-sync). *(idea: hybrid edge)*
- **Anonymized disease/demand trend reports** for pharma/NGOs; group purchasing marketplace. *(ideas: trend data product; group purchasing)*
