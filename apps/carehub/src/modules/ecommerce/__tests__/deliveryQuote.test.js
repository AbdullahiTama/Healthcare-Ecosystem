import { describe, it, expect } from 'vitest'
import { parseDeliveryQuote, quotedTotalKobo, MAX_DELIVERY_QUOTE_KOBO } from '../deliveryQuote'

describe('parseDeliveryQuote', () => {
  it('reads naira as typed, with or without the sign, commas or kobo', () => {
    expect(parseDeliveryQuote('2500')).toEqual({ kobo: 250000 })
    expect(parseDeliveryQuote('₦2,500')).toEqual({ kobo: 250000 })
    expect(parseDeliveryQuote(' 2500.5 ')).toEqual({ kobo: 250050 })
    expect(parseDeliveryQuote('1,000,000')).toEqual({ kobo: MAX_DELIVERY_QUOTE_KOBO })
  })

  it('refuses what the server would refuse, with a reason', () => {
    expect(parseDeliveryQuote('').error).toMatch(/Enter the delivery fee/)
    expect(parseDeliveryQuote('0').error).toMatch(/more than ₦0/)
    expect(parseDeliveryQuote('-5').error).toMatch(/for example/)
    expect(parseDeliveryQuote('abc').error).toMatch(/for example/)
    expect(parseDeliveryQuote('12.345').error).toMatch(/for example/)
    expect(parseDeliveryQuote('1000000.01').error).toMatch(/at most ₦1,000,000/)
  })
})

describe('quotedTotalKobo', () => {
  it('is subtotal + fulfilment + delivery - discount, like the server', () => {
    expect(quotedTotalKobo({ subtotal_kobo: 20000, fulfilment_kobo: 60000, discount_kobo: 10000 }, 250000)).toBe(320000)
    expect(quotedTotalKobo({ subtotal_kobo: 20000 }, 500)).toBe(20500)
  })
})
