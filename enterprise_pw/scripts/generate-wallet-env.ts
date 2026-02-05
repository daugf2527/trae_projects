import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Wallet } from 'ethers'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

const output = getArg('--output')
const target = output
  ? path.resolve(process.cwd(), output)
  : path.resolve(__dirname, '..', '..', 'luckyx_automation', '.env')

const wallet = Wallet.createRandom()
const phrase = wallet.mnemonic?.phrase ?? ''
if (!phrase) {
  console.error('Failed to generate mnemonic')
  process.exit(1)
}

const password = (process.env.METAMASK_PASSWORD ?? '').trim() || '23456qwe'
const content = [
  `METAMASK_PASSWORD=${password}`,
  `METAMASK_SEED_PHRASE=${phrase}`,
  `METAMASK_PRIVATE_KEY=${wallet.privateKey}`,
  ''
].join('\n')

fs.mkdirSync(path.dirname(target), { recursive: true })
fs.writeFileSync(target, content, { encoding: 'utf-8' })

console.log(`Wallet env written to ${target}`)
console.log(`Address: ${wallet.address}`)
