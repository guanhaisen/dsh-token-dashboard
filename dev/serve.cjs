/* A no-store static server for the preview page.
   Usage: node dev/serve.cjs [port] [root] */
'use strict'

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const port = Number(process.argv[2] ?? 8137)
const root = path.resolve(process.argv[3] ?? path.join(__dirname, 'preview'))

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
  const file = path.join(root, path.normalize(rel).replace(/^([/\\])+/, ''))
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden')
    return
  }
  fs.readFile(file, (error, buffer) => {
    if (error) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`not found: ${rel}`)
      return
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      // Load-bearing: a heuristic cache would serve a stale bundle after a
      // rebuild and every visual judgement would be made on the old page.
      'cache-control': 'no-store, no-cache, must-revalidate',
      'access-control-allow-origin': '*',
    })
    res.end(buffer)
  })
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}/`)
})
