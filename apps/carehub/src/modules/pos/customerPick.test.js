import { describe, it, expect } from 'vitest'
import { findClientMatches, exactClient, creditCustomerFor } from './customerPick.js'

const clients = [
  { id: 1, full_name: 'Mama Ngozi', phone: '+234 803 111 2222' },
  { id: 2, full_name: 'Ada Obi', phone: '0802 000 0001' },
  { id: 3, full_name: 'Ada Obi', phone: '0809 000 0002' },
  { id: 4, full_name: 'Ngozi Adaeze', phone: null },
]

describe('findClientMatches', () => {
  it('matches name words in any order, prefix matches first', () => {
    expect(findClientMatches(clients, 'ngozi').map((c) => c.id)).toEqual([4, 1])
    expect(findClientMatches(clients, 'obi ada').map((c) => c.id)).toEqual([2, 3])
  })
  it('matches a phone number whatever its prefix or spacing', () => {
    expect(findClientMatches(clients, '08031112222').map((c) => c.id)).toEqual([1])
    expect(findClientMatches(clients, '0809').map((c) => c.id)).toEqual([3])
  })
  it('returns nothing for an empty query and respects the limit', () => {
    expect(findClientMatches(clients, '  ')).toEqual([])
    expect(findClientMatches(clients, 'a', 2)).toHaveLength(2)
  })
})

describe('exactClient / creditCustomerFor', () => {
  it('only an unambiguous exact name counts; Walk-in never does', () => {
    expect(exactClient(clients, ' mama  ngozi ')?.id).toBe(1)
    expect(exactClient(clients, 'Ada Obi')).toBeNull()
    expect(exactClient(clients, 'Walk-in')).toBeNull()
  })
  it('the picked customer wins while the name still matches it', () => {
    expect(creditCustomerFor(clients[2], 'Ada Obi', clients)?.id).toBe(3)
    expect(creditCustomerFor(clients[2], 'Someone else', clients)).toBeNull()
    expect(creditCustomerFor(null, 'Mama Ngozi', clients)?.id).toBe(1)
  })
})
