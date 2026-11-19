export type ZipEntry = {
  name: string
  data: Uint8Array
}

/**
 * CRC-32 as ZIP uses it, one table entry per byte value.
 */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }

  return value >>> 0
})

function crc32(data: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)

  return (crc ^ 0xffffffff) >>> 0
}

/**
 * A date as the two 16-bit fields ZIP stores: two-second steps, years counted from 1980.
 */
function dosDateTime(date: Date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date:
      (Math.max(0, date.getFullYear() - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate()
  }
}

/**
 * Packs files into a ZIP archive, stored as they are.
 *
 * Nothing is compressed: what goes in here (PNG, video) already is, and a stored archive needs no
 * compression library. Names are written as UTF-8. Archives and files of 4 GB or more aren't supported.
 *
 * @example
 * const zip = createZip([{ name: "notes.md", data: new TextEncoder().encode("# Notes") }])
 */
export function createZip(entries: ZipEntry[]) {
  const encoder = new TextEncoder()
  const stamp = dosDateTime(new Date())
  const parts: Uint8Array[] = []
  const directory: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    // Version needed (2.0), then the flag that says names are UTF-8
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true)
    // Method 0: stored
    local.setUint16(8, 0, true)
    local.setUint16(10, stamp.time, true)
    local.setUint16(12, stamp.date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, size, true)
    local.setUint32(22, size, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true)

    const central = new DataView(new ArrayBuffer(46))
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(4, 20, true)
    central.setUint16(6, 20, true)
    central.setUint16(8, 0x0800, true)
    central.setUint16(10, 0, true)
    central.setUint16(12, stamp.time, true)
    central.setUint16(14, stamp.date, true)
    central.setUint32(16, crc, true)
    central.setUint32(20, size, true)
    central.setUint32(24, size, true)
    central.setUint16(28, name.length, true)
    // No extra field, no comment, disk 0, no attributes: bytes 30 to 41 stay zero
    central.setUint32(42, offset, true)

    parts.push(new Uint8Array(local.buffer), name, entry.data)
    directory.push(new Uint8Array(central.buffer), name)
    offset += 30 + name.length + size
  }

  const directorySize = directory.reduce((total, part) => total + part.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, directorySize, true)
  end.setUint32(16, offset, true)

  return new Blob([...parts, ...directory, new Uint8Array(end.buffer)] as BlobPart[], {
    type: "application/zip"
  })
}
