// WebUSB transport for ESC/POS thermal printers. Talks the USB printer
// class (class code 7) directly from the browser — no driver, no print
// dialog, no rasterization. Chromium-only (navigator.usb); every helper
// degrades gracefully so callers can fall back to window.print() elsewhere.
//
// The usb-like dependency is injectable in every function so tests run
// without hardware or a real navigator.usb.

// USB class code for printer devices (USB Printer Class specification).
const PRINTER_CLASS = 7

export function isEscposUsbSupported(usb = globalThis.navigator?.usb) {
  return typeof usb?.requestDevice === 'function' && typeof usb?.getDevices === 'function'
}

function allAlternates(iface) {
  if (Array.isArray(iface?.alternates) && iface.alternates.length) return iface.alternates
  if (iface?.alternate) return [iface.alternate]
  return []
}

function interfaceClasses(device) {
  const configs = device?.configurations || (device?.configuration ? [device.configuration] : [])
  return configs.flatMap(c => (c.interfaces || []).flatMap(i => allAlternates(i).map(a => a.interfaceClass)))
}

const isPrinterDevice = (device) => interfaceClasses(device).includes(PRINTER_CLASS)

// Printers granted once persist per-origin, so this returns instantly on
// repeat prints without re-prompting.
export async function getPairedPrinters(usb = globalThis.navigator?.usb) {
  if (!isEscposUsbSupported(usb)) return []
  try {
    const devices = await usb.getDevices()
    return (devices || []).filter(isPrinterDevice)
  } catch {
    return []
  }
}

// Must be called inside a user gesture (transient activation) — the POS print
// buttons satisfy this. Resolves null when the user cancels the picker or no
// matching device exists; never throws for those cases.
export async function requestPrinter(usb = globalThis.navigator?.usb) {
  if (!isEscposUsbSupported(usb)) return null
  try {
    return await usb.requestDevice({ filters: [{ classCode: PRINTER_CLASS }] })
  } catch {
    return null
  }
}

// Thrown only when the connection was established but transferOut itself
// failed — i.e. bytes may have partially reached the paper. Callers must NOT
// silently reprint through another channel after this (duplicate receipt).
export class EscposTransferError extends Error {
  constructor(cause) {
    super('Printer connection succeeded but the print job failed during transfer')
    this.name = 'EscposTransferError'
    this.sent = true
    this.cause = cause
  }
}

function findPrinterInterface(configuration) {
  return (configuration?.interfaces || []).find(i => allAlternates(i).some(a => a.interfaceClass === PRINTER_CLASS))
}

function findPrinterConfigValue(device) {
  for (const c of device?.configurations || []) {
    if ((c.interfaces || []).some(i => allAlternates(i).some(a => a.interfaceClass === PRINTER_CLASS))) {
      return c.configurationValue
    }
  }
  return 1
}

export async function printEscpos(bytes, device) {
  let claimedInterface = null
  await device.open()
  try {
    if (!device.configuration) await device.selectConfiguration(findPrinterConfigValue(device))
    const iface = findPrinterInterface(device.configuration)
    if (!iface) throw new Error('No USB printer interface (class 7) on the selected device')
    await device.claimInterface(iface.interfaceNumber)
    claimedInterface = iface.interfaceNumber
    const endpoint = allAlternates(iface).flatMap(a => a.endpoints || []).find(e => e.direction === 'out')
    if (!endpoint) throw new Error('No OUT endpoint on the printer interface')
    try {
      await device.transferOut(endpoint.endpointNumber, bytes)
    } catch (e) {
      throw new EscposTransferError(e)
    }
  } finally {
    if (claimedInterface !== null) { try { await device.releaseInterface(claimedInterface) } catch {} }
    try { await device.close() } catch {}
  }
}
