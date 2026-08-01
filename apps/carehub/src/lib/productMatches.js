// Product matching helpers — the single definition for duplicate detection
// across the app. Previously triplicated in Inventory.jsx and useInventory.js;
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
export function findAllDuplicateGroups(allProducts) {
  const visited = new Set()
  const groups = []
  for (let i = 0; i < allProducts.length; i++) {
    const a = allProducts[i]
    if (visited.has(a.id)) continue
    const nNameA = normalize(a.name)
    const nGenericA = normalize(a.generic_name || a.genericName)
    const group = [a]
    for (let j = i + 1; j < allProducts.length; j++) {
      const b = allProducts[j]
      if (visited.has(b.id)) continue
      const nNameB = normalize(b.name)
      const nGenericB = normalize(b.generic_name || b.genericName)
      const nameMatch = nNameA && nNameB && nNameA === nNameB
      const genericMatch = nGenericA && nGenericB && nGenericA === nGenericB
      if (nameMatch || genericMatch) {
        group.push(b)
        visited.add(b.id)
      }
    }
    if (group.length > 1) {
      visited.add(a.id)
      groups.push(group)
    }
  }
  return groups
}
