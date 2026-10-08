// Hydrating the wishlist from the database must never overwrite what the user did while the request was in flight.
import { render, screen, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ getAllAsync: null, getAll: null, toggle: null, calls: 0 }))
vi.mock('./wishlistRepository', () => ({
  wishlistRepository: {
    getAll: () => h.getAll(),
    getAllAsync: () => { h.calls++; return h.getAllAsync() },
    toggle: (id) => h.toggle(id),
  },
}))

import { WishlistProvider, useWishlist } from './WishlistProvider'

let api
function Probe() {
  api = useWishlist()
  return <div data-testid="ids">{[...api.ids].sort().join(',')}</div>
}
const mount = () => render(<WishlistProvider><Probe /></WishlistProvider>)
const ids = () => screen.getByTestId('ids').textContent

// A promise we resolve by hand, to place the database response before or after a user action.
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  h.calls = 0
  let local = []
  h.getAll = () => local
  h.toggle = (id) => { local = local.includes(id) ? local.filter((x) => x !== id) : [...local, id]; return local }
})

describe('WishlistProvider hydration', () => {
  it('loads the wishlist from the database once', async () => {
    h.getAllAsync = async () => ['a']
    await act(async () => { mount() })

    expect(h.calls).toBe(1)
    expect(ids()).toBe('a')
  })

  it('keeps a product the user added while the database request was in flight', async () => {
    const db = deferred()
    h.getAllAsync = () => db.promise
    await act(async () => { mount() })

    await act(async () => { api.toggle('y') })
    await act(async () => { db.resolve(['x']) })

    expect(ids()).toBe('x,y')
  })

  it('keeps a removal the user made while the database request was in flight', async () => {
    const db = deferred()
    h.getAllAsync = () => db.promise
    await act(async () => { mount() })

    await act(async () => { api.toggle('x') }) // adds x locally...
    await act(async () => { api.toggle('x') }) // ...and removes it again before the database answers
    await act(async () => { db.resolve(['x']) })

    expect(ids()).toBe('')
  })

  it('falls back to the local wishlist when the database cannot be read', async () => {
    h.getAll = () => ['local']
    h.getAllAsync = async () => { throw new Error('offline') }
    await act(async () => { mount() })

    expect(ids()).toBe('local')
  })
})
