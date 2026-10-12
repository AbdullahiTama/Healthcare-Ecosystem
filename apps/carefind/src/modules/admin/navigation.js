import {
  LayoutDashboard, Bell, Users, Building2, UserCheck, Shield, Flag, Layers, ShoppingBag, ClipboardCheck,
  FileText, Image, Newspaper, Target, Radio, DollarSign, Landmark, ShieldCheck, ClipboardList,
  Search, Pill, SlidersHorizontal, AlertTriangle, Mail,
} from 'lucide-react'

// The admin's section map. Group order and membership are presentation only;
// what a given admin may do is decided by the server. `permissions` here only
// hides entries a role has switched off, as a courtesy to the operator.
//
// `permissionKey`: an item that has no role-assignable switch of its own is
// shown or hidden by another item's switch (feed tools follow `overview`, the
// permission that exposed them before they were given their own entry).
export const NAV_GROUPS = [
  { id: 'overview', label: 'Overview', items: [
    { key: 'overview', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'notifications', label: 'Alerts', icon: Bell },
  ] },
  { id: 'platform', label: 'Platform', items: [
    { key: 'users', label: 'Users', icon: Users },
    { key: 'businesses', label: 'Businesses', icon: Building2 },
  ] },
  { id: 'trust', label: 'Trust & Verification', items: [
    { key: 'verifications', label: 'Verifications', icon: UserCheck },
    { key: 'claims', label: 'Claims', icon: Shield },
    { key: 'reports', label: 'Reports', icon: Flag },
    { key: 'moderation', label: 'Moderation queue', icon: Layers },
  ] },
  { id: 'marketplace', label: 'Marketplace', items: [
    { key: 'shop', label: 'Shop', icon: ShoppingBag },
    { key: 'orders', label: 'Orders', icon: ClipboardCheck },
  ] },
  { id: 'content', label: 'Content', items: [
    { key: 'posts', label: 'Posts', icon: FileText },
    { key: 'stories', label: 'Stories', icon: Image },
    { key: 'news', label: 'News', icon: Newspaper },
    { key: 'promotions', label: 'Promotions', icon: Target },
    { key: 'golive', label: 'Go live', icon: Radio },
  ] },
  { id: 'finance', label: 'Finance', items: [
    { key: 'revenue', label: 'Revenue', icon: DollarSign },
    { key: 'withdrawals', label: 'Withdrawals', icon: Landmark },
    { key: 'reconciliation', label: 'Money checks', icon: ShieldCheck },
  ] },
  { id: 'operations', label: 'Operations', items: [
    { key: 'tasks', label: 'Tasks', icon: ClipboardList },
    { key: 'teams', label: 'Teams', icon: Users },
  ] },
  { id: 'analytics', label: 'Analytics', items: [
    { key: 'searches', label: 'Searches', icon: Search },
    { key: 'drugs', label: 'Drug intel', icon: Pill },
    { key: 'feed_ranking', label: 'Feed ranking', icon: SlidersHorizontal, permissionKey: 'overview' },
  ] },
  { id: 'system', label: 'System', items: [
    { key: 'audit_log', label: 'Audit log', icon: ClipboardCheck },
    { key: 'errors', label: 'Errors', icon: AlertTriangle },
    { key: 'email_templates', label: 'Email templates', icon: Mail },
  ] },
]

const ITEMS = NAV_GROUPS.flatMap(g => g.items.map(item => ({ ...item, group: g.label })))

// Tabs a role can switch on or off (role editor in Teams).
export const ALL_TABS = ITEMS.filter(i => !i.permissionKey)

export function findItem(key) {
  return ITEMS.find(i => i.key === key) || null
}

const allowed = (permissions, item) => permissions?.[item.permissionKey || item.key] !== false

export function isAllowed(permissions, key) {
  const item = findItem(key)
  return item ? allowed(permissions, item) : false
}

export function visibleGroups(permissions) {
  return NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => allowed(permissions, i)) }))
    .filter(g => g.items.length > 0)
}
