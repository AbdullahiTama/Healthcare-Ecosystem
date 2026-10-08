import { describe, it, expect, vi } from 'vitest'
import {
  isEscposUsbSupported, getPairedPrinters, requestPrinter, printEscpos, EscposTransferError,
} from './escposUsb.js'

const PRINTER_BYTES = new Uint8Array([0x1b, 0x40, 0x1d, 0x56, 0x42, 0x00])

// A USBDevice-shaped mock exposing one class-7 printer interface with a
// single OUT endpoint at address 1.
function mockDevice({ transferOutImpl } = {}) {
  const calls = { open: 0, configurations: [], claimed: [], transfers: [], close: 0 }
  const configuration = {
    interfaces: [{
      interfaceNumber: 0,
      alternate: { interfaceClass: 7, endpoints: [{ direction: 'out', endpointNumber: 1 }] },
    }],
  }
  const device = {
    configuration,
    open: vi.fn(async () => { calls.open++ }),
    // Mirrors WebUSB: selecting a configuration populates device.configuration.
    selectConfiguration: vi.fn(async (n) => {
      calls.configurations.push(n)
      device.configuration = configuration
    }),
    claimInterface: vi.fn(async (n) => { calls.claimed.push(n) }),
    transferOut: vi.fn(async (ep, data) => {
      calls.transfers.push([ep, data])
      if (transferOutImpl) return transferOutImpl(ep, data)
      return { status: 'ok', bytesWritten: data.byteLength }
    }),
    close: vi.fn(async () => { calls.close++ }),
  }
  return { device, calls }
}

describe('isEscposUsbSupported', () => {
  it('is false when WebUSB is unavailable (Firefox/Safari/iOS)', () => {
    expect(isEscposUsbSupported(undefined)).toBe(false)
    expect(isEscposUsbSupported({})).toBe(false)
  })

  it('is true when a usable navigator.usb is present', () => {
    expect(isEscposUsbSupported({ requestDevice: () => {}, getDevices: () => {} })).toBe(true)
  })
})

describe('getPairedPrinters', () => {
  it('returns only devices exposing a printer-class interface', async () => {
    const printer = mockDevice().device
    const nonPrinter = mockDevice().device
    nonPrinter.configuration.interfaces[0].alternate.interfaceClass = 255
    const usb = { getDevices: vi.fn(async () => [nonPrinter, printer]), requestDevice: () => {} }
    await expect(getPairedPrinters(usb)).resolves.toEqual([printer])
  })

  it('returns an empty list when WebUSB is unsupported or getDevices fails', async () => {
    await expect(getPairedPrinters(undefined)).resolves.toEqual([])
    await expect(getPairedPrinters({ getDevices: async () => { throw new Error('boom') } })).resolves.toEqual([])
  })
})

describe('requestPrinter', () => {
  it('returns the granted device from the picker', async () => {
    const granted = mockDevice().device
    const usb = { requestDevice: vi.fn(async () => granted), getDevices: () => {} }
    await expect(requestPrinter(usb)).resolves.toBe(granted)
    expect(usb.requestDevice).toHaveBeenCalledWith({ filters: [{ classCode: 7 }] })
  })

  it('resolves null when the user cancels the picker (NotFoundError) — never throws', async () => {
    const usb = { requestDevice: vi.fn(async () => { throw new DOMException('No device selected', 'NotFoundError') }), getDevices: () => {} }
    await expect(requestPrinter(usb)).resolves.toBeNull()
  })

  it('resolves null when WebUSB is unsupported', async () => {
    await expect(requestPrinter(undefined)).resolves.toBeNull()
  })
})

describe('printEscpos', () => {
  it('opens, claims the printer interface and writes the bytes to the OUT endpoint', async () => {
    const { device, calls } = mockDevice()
    await printEscpos(PRINTER_BYTES, device)
    expect(calls.open).toBe(1)
    expect(calls.claimed).toEqual([0])
    expect(calls.transfers).toEqual([[1, PRINTER_BYTES]])
    expect(calls.close).toBe(1)
  })

  it('selects configuration 1 when the device has none yet', async () => {
    const { device, calls } = mockDevice()
    delete device.configuration
    await printEscpos(PRINTER_BYTES, device)
    expect(calls.configurations).toEqual([1])
  })

  it('rejects before any transfer when no printer interface exists', async () => {
    const { device, calls } = mockDevice()
    device.configuration.interfaces[0].alternate.interfaceClass = 255
    await expect(printEscpos(PRINTER_BYTES, device)).rejects.toThrow(/No USB printer interface/)
    expect(calls.transfers).toEqual([])
    expect(calls.close).toBe(1)
  })

  it('rejects before any transfer when the interface has no OUT endpoint', async () => {
    const { device, calls } = mockDevice()
    device.configuration.interfaces[0].alternate.endpoints = []
    await expect(printEscpos(PRINTER_BYTES, device)).rejects.toThrow(/No OUT endpoint/)
    expect(calls.transfers).toEqual([])
  })

  it('wraps a failed transferOut in EscposTransferError flagged as sent', async () => {
    const { device, calls } = mockDevice({
      transferOutImpl: async () => { throw new Error('babble') },
    })
    const err = await printEscpos(PRINTER_BYTES, device).catch(e => e)
    expect(err).toBeInstanceOf(EscposTransferError)
    expect(err.sent).toBe(true)
    expect(err.cause.message).toBe('babble')
    expect(calls.transfers.length).toBe(1)
    expect(calls.close).toBe(1)
  })

  it('closes the device even when opening/claiming fails midway', async () => {
    const { device, calls } = mockDevice()
    device.claimInterface = vi.fn(async () => { throw new Error('claim failed') })
    await expect(printEscpos(PRINTER_BYTES, device)).rejects.toThrow('claim failed')
    expect(calls.close).toBe(1)
  })
})
