/* Build the preview page: the plugin's real client bundle, the shell's real
   design tokens, React, and a payload captured from the live ledger.
 *
 *   node dev/preview/build-data.cjs   # ledger -> data.json
 *   node dev/preview/build.cjs        # data + tokens + client.js -> app.js
 *   node dev/serve.cjs 8137           # no-store server
 *
 * Two inputs are not vendored in this checkout, so both are configurable:
 *   PREVIEW_MODULES  a node_modules with esbuild and React (default: the
 *                    author's local install)
 *   PREVIEW_ASAR     the installed app.asar to lift the shell's tokens from
 *                    (default: the desktop install under D:\App)
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { extract } = require('../lib/asar.cjs')

const ROOT = path.join(__dirname, '..', '..')
const NM = process.env.PREVIEW_MODULES ?? 'D:\\VibeCoding\\Zcode\\PersonalWorkplace\\node_modules'
const ASAR = process.env.PREVIEW_ASAR ?? 'D:\\App\\DeepSeekHarness\\resources\\app.asar'
const THEME_ENTRY = 'dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'

function esbuildBinary() {
  const candidates = [
    path.join(NM, '@esbuild', 'win32-x64', 'esbuild.exe'),
    path.join(NM, 'esbuild', 'bin', 'esbuild'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate !== candidates[1] ? candidate : process.execPath
  }
  throw new Error(`no esbuild under ${NM}; set PREVIEW_MODULES to a node_modules that has it`)
}

/**
 * Every `var x_css_default = "..."` literal in the theme bundle is one CSS chunk.
 *
 * Reading the tokens out of the installed app rather than copying them by hand
 * is what keeps the preview honest: a token the shell adds or changes shows up
 * here on the next build, instead of the preview quietly disagreeing with the
 * application it is meant to stand in for.
 */
function extractTokens() {
  const source = extract(ASAR, THEME_ENTRY)
  if (source === undefined) throw new Error(`no theme bundle at ${THEME_ENTRY} in ${ASAR}`)
  const chunks = []
  const pattern = /var\s+\w*_css_default\s*=\s*"((?:[^"\\]|\\.)*)"/g
  let match
  while ((match = pattern.exec(source)) !== null) {
    chunks.push(match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n'))
  }
  const all = chunks.join('\n')
  if (!all.includes('--dsw-alias-bg-base')) throw new Error('the token extraction found no aliases')
  return all
}

function bundle() {
  const binary = esbuildBinary()
  const args = [
    path.join(__dirname, 'entry.jsx'),
    '--bundle',
    '--format=iife',
    '--target=chrome120',
    '--jsx=automatic',
    '--define:process.env.NODE_ENV="development"',
    `--alias:react=${path.join(NM, 'react')}`,
    `--alias:react-dom=${path.join(NM, 'react-dom')}`,
    `--outfile=${path.join(__dirname, 'app.js')}`,
    '--log-level=warning',
  ]
  // esbuild's own launcher is a JS entry point; its platform binary is not.
  execFileSync(binary.endsWith('.exe') ? binary : process.execPath, binary.endsWith('.exe') ? args : [binary, ...args], {
    stdio: 'inherit',
  })
}

function main() {
  if (!fs.existsSync(path.join(__dirname, 'data.json'))) {
    throw new Error('no data.json — run: node dev/preview/build-data.cjs')
  }
  fs.writeFileSync(path.join(__dirname, 'tokens.css'), extractTokens())
  bundle()
  fs.writeFileSync(
    path.join(__dirname, 'index.html'),
    fs.readFileSync(path.join(__dirname, 'shell.html'), 'utf8'),
  )
  console.log('wrote index.html')
}

main()
