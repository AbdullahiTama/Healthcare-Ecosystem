import { ShieldCheck, Tag, Truck } from 'lucide-react'

// The three promises CareFind repeats on its acquisition surfaces (login, shop hero). One list so the wording and
// icons never drift between screens; each surface decides how to lay it out.
export const TRUST_POINTS = [
  { Icon: ShieldCheck, title: 'Verified sellers', text: 'Trusted pharmacies & suppliers' },
  { Icon: Truck, title: 'Fast & reliable', text: 'Get products near you' },
  { Icon: Tag, title: 'Compare prices', text: 'Find the best deals' },
]
