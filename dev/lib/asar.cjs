/* Minimal reader for an Electron ASAR archive.
   An ASAR is a 16-byte pickle header, a JSON directory blob, then the file
   bytes back to back. This reads both halves without Electron. */
'use strict'

const fs = require('node:fs')

/**
 * Read one archive's directory listing.
 *
 * Pickle layout: `uint32 4`, `uint32 headerSize + 8`, `uint32 headerSize + 4`,
 * `uint32 headerSize`, then the JSON blob — so the size sits at offset 12, not
 * in the 8-byte field a BigUint64 read would land on.
 * @param file - path to the `.asar`.
 * @returns `{ entries, dataStart }`, `entries` being `{ path, size, offset }`.
 */
function readArchive(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(16)
    fs.readSync(fd, head, 0, 16, 0)
    const headerSize = head.readUInt32LE(12)
    const json = Buffer.alloc(headerSize)
    fs.readSync(fd, json, 0, headerSize, 16)

    const entries = []
    const walk = (node, prefix) => {
      for (const [name, entry] of Object.entries(node.files ?? {})) {
        const full = `${prefix}${name}`
        if (entry.files) walk(entry, `${full}/`)
        else entries.push({ path: full, size: entry.size, offset: Number(entry.offset) })
      }
    }
    walk(JSON.parse(json.toString('utf8')), '')
    return { entries, dataStart: 16 + headerSize }
  } finally {
    fs.closeSync(fd)
  }
}

/** Read one file out of an open archive. */
function readEntry(file, archive, entry) {
  const fd = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(entry.size)
    fs.readSync(fd, buffer, 0, entry.size, archive.dataStart + entry.offset)
    return buffer
  } finally {
    fs.closeSync(fd)
  }
}

/** Read one path out of an archive, or undefined when it is not there. */
function extract(asar, wanted) {
  const archive = readArchive(asar)
  const entry = archive.entries.find((item) => item.path === wanted)
  if (entry === undefined) return undefined
  return readEntry(asar, archive, entry).toString('utf8')
}

module.exports = { readArchive, extract }

// CLI: `node dev/lib/asar.cjs list <asar> [filter]` / `... get <asar> <path>`
if (require.main === module) {
  const [, , action, asar, rest] = process.argv
  if (action === 'list') {
    for (const entry of readArchive(asar).entries) {
      if (rest !== undefined && !entry.path.includes(rest)) continue
      console.log(`${String(entry.size).padStart(10)}  ${entry.path}`)
    }
  } else if (action === 'get') {
    const text = extract(asar, rest)
    if (text === undefined) {
      console.error(`not found: ${rest}`)
      process.exit(1)
    }
    process.stdout.write(text)
  } else {
    console.error('usage: asar.cjs list <asar> [filter] | get <asar> <path>')
    process.exit(2)
  }
}
