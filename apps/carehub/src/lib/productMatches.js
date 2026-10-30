// Product matching helpers — the single definition for duplicate detection
// across the app. Previously triplicated in Inventory.jsx and a since-deleted
// copy of its logic (hooks/useInventory.js);
// Purchases.jsx also uses findDuplicate to sync purchased items into existing
// inventory instead of creating duplicates.
export function normalize(str) {
  return (str || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
}

// Find an existing product that matches by brand name OR generic name (normalized)
export function findDuplicate(existingProducts, name, genericName, excludeId) {
  const nName = normalize(name)
  const nGeneric = normalize(genericName)
  if (!nName && !nGeneric) return null
  return existingProducts.find(p => {
    if (excludeId && p.id === excludeId) return false
    const pName = normalize(p.name)
    const pGeneric = normalize(p.generic_name || p.genericName)
    const nameMatch = nName && pName && nName === pName
    const genericMatch = nGeneric && pGeneric && nGeneric === pGeneric
    return nameMatch || genericMatch
  }) || null
}

// Scan the full product list and group items that match each other by name or generic name.
// Returns an array of groups, each group is an array of 2+ products considered duplicates of each other.
// Matching is transitive: A matches B by generic name and B matches C by brand name
// collapse A, B and C into a single group, so chained near-duplicates are never split.
export function findAllDuplicateGroups(allProducts) {
  const parent = new Map()
  const find = (id) => {
    if (!parent.has(id)) parent.set(id, id)
    if (parent.get(id) === id) return id
    const root = find(parent.get(id))
    parent.set(id, root)
    return root
  }
  const union = (a, b) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootA, rootB)
  }

  // First product id seen for each normalized name/generic key
  const seen = new Map()
  for (const p of allProducts) {
    const name = normalize(p.name)
    const generic = normalize(p.generic_name || p.genericName)
    for (const key of [name, generic].filter(Boolean)) {
      if (seen.has(key)) union(p.id, seen.get(key))
      else seen.set(key, p.id)
    }
  }

  const groups = new Map()
  for (const p of allProducts) {
    const root = find(p.id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(p)
  }
  return [...groups.values()].filter((g) => g.length > 1)
}

// A lookup with exactly findDuplicate's answer (the first product in list
// order whose normalized name or generic name matches) that is built once in
// O(n) and answers each query in O(1). Bulk CSV import used to call
// findDuplicate per row, which is O(rows × catalog) regex work and froze older
// devices on a 3,000-product catalog.
export function createDuplicateIndex(existingProducts) {
  const byName = new Map()
  const byGeneric = new Map()
  existingProducts.forEach((p, i) => {
    const pName = normalize(p.name)
    const pGeneric = normalize(p.generic_name || p.genericName)
    if (pName && !byName.has(pName)) byName.set(pName, i)
    if (pGeneric && !byGeneric.has(pGeneric)) byGeneric.set(pGeneric, i)
  })
  return {
    find(name, genericName) {
      const nName = normalize(name)
      const nGeneric = normalize(genericName)
      const hits = []
      if (nName && byName.has(nName)) hits.push(byName.get(nName))
      if (nGeneric && byGeneric.has(nGeneric)) hits.push(byGeneric.get(nGeneric))
      return hits.length ? existingProducts[Math.min(...hits)] : null
    },
  }
}
