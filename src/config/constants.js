// Reference/lookup data used across the app (business taxonomy, states,
// category lists). Moved out of lib/utils.js, which now holds only generic
// helpers and design tokens.
export const BUSINESS_TYPES = [
  { id: 'skincare',            icon: '🧴', name: 'Skincare / Aesthetic Spa' },
  { id: 'pharmacy',            icon: '💊', name: 'Community Pharmacy' },
  { id: 'hospital',            icon: '🏥', name: 'Hospital / Clinic' },
  { id: 'dental',              icon: '🦷', name: 'Dental Clinic' },
  { id: 'optical',             icon: '👁', name: 'Optical / Eye Clinic' },
  { id: 'wellness',            icon: '🌿', name: 'Wellness & Nutrition Center' },
  { id: 'manufacturer_importer', icon: '🏭', name: 'Manufacturer / Importer' },
  { id: 'wholesale',           icon: '📦', name: 'Wholesale / Distributor' },
]

export const NIG_STATES = ['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara']

export const EXPENSE_CATS = ['Rent','Salary','Utilities','Supplies','Equipment','Transport','Marketing','Maintenance','Insurance','Tax','Other']

export const PRODUCT_CATS = ['Medicines','Skincare','Cosmetics','Services','Consumables','Equipment','Tools','Other']

export const PRODUCT_EMOJIS = ['💊','🧴','☀️','🫧','✨','💆','💎','🩺','🩸','🧤','📦','🌿','🔧','💉','🩹','🫀','🧬','🏥']
