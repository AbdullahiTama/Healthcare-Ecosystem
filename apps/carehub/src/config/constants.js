// Reference/lookup data used across the app (business taxonomy, states,
// category lists). Moved out of lib/utils.js, which now holds only generic
// helpers and design tokens.
export const BUSINESS_TYPES = [
  { id: 'pharmacy',      icon: '💊', name: 'Pharmacies' },
  { id: 'hospital',      icon: '🏥', name: 'Hospitals' },
  { id: 'clinic',        icon: '🩺', name: 'Clinics & Medical Centres' },
  { id: 'laboratory',    icon: '🧪', name: 'Laboratories' },
  { id: 'aesthetic',     icon: '✨', name: 'Aesthetic Clinics' },
  { id: 'spa',           icon: '🌿', name: 'Spas & Wellness Centres' },
  { id: 'cosmetics',     icon: '💄', name: 'Cosmetics & Beauty' },
  { id: 'haircare',      icon: '💇', name: 'Hair-Care & Salons' },
  { id: 'other',         icon: '🏥', name: 'Other Healthcare' },
]

export const NIG_STATES = ['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara']

export const EXPENSE_CATS = ['Rent','Salary','Utilities','Supplies','Equipment','Transport','Marketing','Maintenance','Insurance','Tax','Other']

export const PRODUCT_CATS = ['Medicines','Skincare','Cosmetics','Services','Consumables','Equipment','Tools','Other']

export const PRODUCT_EMOJIS = ['💊','🧴','☀️','🫧','✨','💆','💎','🩺','🩸','🧤','📦','🌿','🔧','💉','🩹','🫀','🧬','🏥']
