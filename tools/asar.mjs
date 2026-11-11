import fs from 'node:fs'
import path from 'node:path'

const asar = process.argv[2]
const mode = process.argv[3]
const outDir = process.argv[4]
const prefixes = process.argv.slice(5)

const fd = fs.openSync(asar, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16)
const headerLen = head.readUInt32LE(12)
const headerBuf = Buffer.alloc(headerLen)
fs.readSync(fd, headerBuf, 0, headerLen, 16)
const header = JSON.parse(headerBuf.toString('utf8').replace(/\0+$/, ''))
const base = 16 + headerLen

const picked = []
function walk(node, prefix) {
  for (const [name, value] of Object.entries(node.files ?? {})) {
    const p = prefix + '/' + name
    if (value.files) walk(value, p)
    else if (typeof value.size === 'number' && value.offset !== undefined) {
      if (prefixes.length === 0 || prefixes.some((pre) => p.startsWith(pre))) picked.push({ p, value })
    }
  }
}
walk(header, '')

if (mode === 'list') {
  for (const { p, value } of picked) console.log(`${value.size}\t${p}`)
} else {
  for (const { p, value } of picked) {
    const buf = Buffer.alloc(value.size)
    fs.readSync(fd, buf, 0, value.size, base + Number(value.offset))
    const target = path.join(outDir, p.replace(/^\//, ''))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, buf)
  }
  console.log(`extracted ${picked.length} files`)
}
