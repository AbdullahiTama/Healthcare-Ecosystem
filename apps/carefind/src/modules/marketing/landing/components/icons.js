// Landing pages need an icon per content entry, but the content file is plain
// data (no JSX, no imports of components). This is the one place that maps the
// content file's icon keys to real lucide components — a missing key falls back
// to a neutral mark rather than crashing the page.

import {
  Activity, BadgeCheck, Building2, Calendar, Eye, FlaskConical, Hospital,
  Leaf, Lock, MapPin, MessageCircle, Phone, Pill, Scan, ShieldCheck, ShoppingBag,
  Smile, Star, Store, Stethoscope, Wallet,
} from 'lucide-react'

const ICONS = {
  Activity,
  BadgeCheck,
  Building2,
  Calendar,
  Eye,
  FlaskConical,
  Hospital,
  Leaf,
  Lock,
  MapPin,
  MessageCircle,
  Phone,
  Pill,
  Scan,
  ShieldCheck,
  ShoppingBag,
  Smile,
  Star,
  Stethoscope,
  Store,
  Wallet,
}

export function resolveIcon(key) {
  return ICONS[key] || Store
}

export default ICONS
