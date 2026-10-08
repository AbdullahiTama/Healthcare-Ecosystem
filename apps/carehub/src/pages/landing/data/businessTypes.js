import { BUSINESS_TYPES } from '../../../config/constants'

// Per-business-type notes for the "Built for healthcare businesses" section.
//
// The list itself is the real BUSINESS_TYPES from config/constants.js — nothing
// is added, renamed or invented. Each note is written against the real module
// and permission system in src/lib/permissions.js, so every claim here is one
// the product can actually back:
//   - Hospitals genuinely get labelByType { hospital: 'Patients' } plus the
//     reception / triage / doctor / rx_inbox / lab / imaging modules.
//   - Pharmacy, cosmetic and wholesale-facing types genuinely get POS,
//     inventory, cost prices and the ecommerce path to CareFind.
//   - Appointment-driven types (clinic, spa, aesthetic, haircare) genuinely
//     get the appointments and consultation modules.
// Where a type has no distinct note, it gets the general operating note rather
// than an invented specialty.
const NOTES = {
  pharmacy: 'Point of sale, stock control with cost prices and reorder points, staff accounts and customer history — with eligible products listed on CareFind.',
  hospital: 'Patients, reception, triage, consultations, lab, imaging and pharmacy records carried as one patient flow.',
  clinic: 'Appointments, consultations, client records, staff scheduling and the services you actually bill for.',
  laboratory: 'Laboratory services and requests, results, client billing and the stock your consumables depend on.',
  aesthetic: 'Treatments and appointments, the clinicians delivering them, and the products you retail alongside.',
  spa: 'Appointments, service menus, therapist assignments and product sales in one place.',
  cosmetics: 'Product catalogue, stock levels, counter sales, staff and repeat-customer history.',
  haircare: 'Appointments, service menus, stylist assignments and the product stock behind the chair.',
  other: 'Sales, stock, staff, locations and reporting, shaped around the business you actually run.',
}

const FALLBACK = 'Sales, stock, staff, locations and reporting, shaped around the business you actually run.'

export const BUSINESS_TYPE_CARDS = BUSINESS_TYPES.map((t) => ({
  id: t.id,
  name: t.name,
  icon: t.icon,
  note: NOTES[t.id] || FALLBACK,
}))
