import { matchTier, distanceBetween, rankProducts, rankSellers } from './nearbyRanking'

// Lagos reference points: the user in Yaba; sellers in Yaba (~0.5 km), Ikeja (~10 km) and Lekki (~20 km).
const USER = { lat: 6.5095, lng: 3.3711 }
const YABA = { lat: 6.5140, lng: 3.3720 }
const IKEJA = { lat: 6.6018, lng: 3.3515 }
const LEKKI = { lat: 6.4474, lng: 3.5440 }

const p = (id, over = {}) => ({ id, name: 'Paracetamol 500mg', generic_name: 'Paracetamol', category: 'Medicines', stock: 10, coords: null, created_at: '2026-11-01', ...over })
const pick = (r) => ({ name: r.name, genericName: r.generic_name, category: r.category, stock: r.stock, coords: r.coords, createdAt: r.created_at })
const ids = (rows) => rows.map((r) => r.id)

describe('matchTier', () => {
  it('ranks a name or generic name starting with the search first, then containing it, then category only', () => {
    expect(matchTier('para', { name: 'Paracetamol' })).toBe(0)
    expect(matchTier('para', { name: 'Emzor', genericName: 'Paracetamol' })).toBe(0)
    expect(matchTier('cetamol', { name: 'Paracetamol' })).toBe(1)
    expect(matchTier('medicine', { name: 'Paracetamol', category: 'Medicines' })).toBe(2)
    expect(matchTier('zzz', { name: 'Paracetamol' })).toBe(3)
  })
  it('treats an empty search as matching everything equally', () => {
    expect(matchTier('  ', { name: 'Anything' })).toBe(0)
  })
  it('ignores case and surrounding spaces', () => {
    expect(matchTier('  PARA ', { name: 'paracetamol' })).toBe(0)
  })
})

describe('distanceBetween', () => {
  it('measures metres between two points', () => {
    const d = distanceBetween(USER, IKEJA)
    expect(d).toBeGreaterThan(9000)
    expect(d).toBeLessThan(12000)
  })
  it('is null without a usable location on either side', () => {
    expect(distanceBetween(null, YABA)).toBeNull()
    expect(distanceBetween(USER, null)).toBeNull()
    expect(distanceBetween(USER, { lat: 'x', lng: 3 })).toBeNull()
    expect(distanceBetween(USER, { lat: 120, lng: 3 })).toBeNull()
  })
})

describe('rankProducts', () => {
  it('puts the nearest pharmacy first among equally relevant, available products', () => {
    const rows = [p('lekki', { coords: LEKKI }), p('ikeja', { coords: IKEJA }), p('yaba', { coords: YABA })]
    expect(ids(rankProducts(rows, { query: 'paracetamol', userCoords: USER, pick }))).toEqual(['yaba', 'ikeja', 'lekki'])
  })

  it('keeps availability above distance: an in-stock pharmacy further away beats an out-of-stock one next door', () => {
    const rows = [p('yaba-out', { coords: YABA, stock: 0 }), p('lekki-in', { coords: LEKKI })]
    expect(ids(rankProducts(rows, { query: 'paracetamol', userCoords: USER, pick }))).toEqual(['lekki-in', 'yaba-out'])
  })

  it('keeps relevance above distance: a category-only match nearby comes after a name match further away', () => {
    const rows = [p('near-cat', { name: 'Vitamin C', generic_name: 'Ascorbic acid', category: 'Paracetamol & pain', coords: YABA }), p('far-name', { coords: LEKKI })]
    expect(ids(rankProducts(rows, { query: 'paracetamol', userCoords: USER, pick }))).toEqual(['far-name', 'near-cat'])
  })

  it('ranks distance before the finer starts-with / contains difference', () => {
    const rows = [p('far-starts', { coords: LEKKI }), p('near-contains', { name: 'Emzor Paracetamol', generic_name: '', coords: YABA })]
    expect(ids(rankProducts(rows, { query: 'paracetamol', userCoords: USER, pick }))).toEqual(['near-contains', 'far-starts'])
  })

  it('puts sellers with no known location after every located one', () => {
    const rows = [p('unknown'), p('lekki', { coords: LEKKI })]
    expect(ids(rankProducts(rows, { query: 'paracetamol', userCoords: USER, pick }))).toEqual(['lekki', 'unknown'])
  })

  it('without the user\'s location: relevance, availability, then newest', () => {
    const rows = [
      p('old', { created_at: '2026-01-01', coords: YABA }),
      p('new', { created_at: '2026-11-20', coords: LEKKI }),
      p('out', { created_at: '2026-11-24', stock: 0 }),
    ]
    expect(ids(rankProducts(rows, { query: 'paracetamol', userCoords: null, pick }))).toEqual(['new', 'old', 'out'])
  })

  it('treats unknown stock as available', () => {
    const rows = [p('zero', { stock: 0, coords: YABA }), p('unknown', { stock: null, coords: LEKKI })]
    expect(ids(rankProducts(rows, { query: '', userCoords: USER, pick }))).toEqual(['unknown', 'zero'])
  })

  it('adds distance_m to located rows and leaves the input untouched', () => {
    const rows = [p('yaba', { coords: YABA }), p('none')]
    const out = rankProducts(rows, { query: '', userCoords: USER, pick })
    expect(out[0].distance_m).toBeGreaterThan(0)
    expect(out[1].distance_m).toBeUndefined()
    expect(rows[0].distance_m).toBeUndefined()
  })

  it('is stable for ties', () => {
    const rows = [p('a'), p('b'), p('c')]
    expect(ids(rankProducts(rows, { query: '', userCoords: null, pick }))).toEqual(['a', 'b', 'c'])
  })
})

describe('rankSellers (a medicine\'s "Where to buy")', () => {
  const s = (id, over = {}) => ({ id, stock: 5, coords: null, price: 500, ...over })
  const pickS = (r) => ({ stock: r.stock, coords: r.coords, price: r.price })

  it('nearest in-stock seller first, then by price', () => {
    const rows = [s('lekki-cheap', { coords: LEKKI, price: 300 }), s('yaba', { coords: YABA, price: 700 }), s('ikeja', { coords: IKEJA })]
    expect(ids(rankSellers(rows, { userCoords: USER, pick: pickS }))).toEqual(['yaba', 'ikeja', 'lekki-cheap'])
  })
  it('out of stock last, even next door', () => {
    const rows = [s('yaba-out', { coords: YABA, stock: 0 }), s('lekki', { coords: LEKKI })]
    expect(ids(rankSellers(rows, { userCoords: USER, pick: pickS }))).toEqual(['lekki', 'yaba-out'])
  })
  it('without a location: in stock, then cheapest; a hidden price last', () => {
    const rows = [s('dear', { price: 900 }), s('hidden', { price: null }), s('cheap', { price: 200 }), s('out', { stock: 0, price: 100 })]
    expect(ids(rankSellers(rows, { userCoords: null, pick: pickS }))).toEqual(['cheap', 'dear', 'hidden', 'out'])
  })
})
