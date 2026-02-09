import path from 'node:path'
import crypto from 'node:crypto'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import process from 'node:process'
import dotenv from 'dotenv'

type AccountConfig = {
  label: string
  proxy?: string
  metamaskPassword: string
  metamaskSeedPhrase?: string
  metamaskPrivateKey?: string
}

const OUT_DIR = path.join(process.cwd(), 'wallet-setup', 'generated')
dotenv.config({ path: path.resolve(process.cwd(), '../luckyx_automation/.env') })
dotenv.config()

async function main(): Promise<void> {
  const accounts = loadAccountsFromEnv()
  if (!accounts.length) {
    throw new Error('未读取到账号，无法生成 wallet setup 文件')
  }

  await mkdir(OUT_DIR, { recursive: true })
  await cleanupOldSetupFiles(OUT_DIR)

  for (const account of accounts) {
    const label = sanitizeLabel(account.label)
    const filePath = path.join(OUT_DIR, `${label}.setup.ts`)
    const walletDiscriminator = stableId(`${label}|${account.metamaskSeedPhrase ?? ''}|${account.metamaskPrivateKey ?? ''}`)

    const content = `import type { BrowserContext, Page } from '@playwright/test'\nimport { defineWalletSetup } from '@synthetixio/synpress'\nimport { loadAccounts } from '../../src/accounts.js'\nimport { runWalletSetupForAccount } from '../../tests/wallet-setup/setupFlow.js'\n\nconst ACCOUNT_LABEL = ${JSON.stringify(label)}\nconst WALLET_DISCRIMINATOR = ${JSON.stringify(walletDiscriminator)}\nconst account = loadAccounts().find((item) => item.label === ACCOUNT_LABEL)\n\nif (!account) {\n  throw new Error(\`[wallet-setup] 未找到账号: \${ACCOUNT_LABEL}\`)\n}\n\nexport default defineWalletSetup(account.metamaskPassword, async (context: BrowserContext, walletPage: Page) => {\n  const walletDiscriminator = WALLET_DISCRIMINATOR\n  void walletDiscriminator\n  await runWalletSetupForAccount(account, context, walletPage)\n})\n`

    await writeFile(filePath, content, 'utf-8')
  }

  await writeGeneratedIndex(accounts.map((account) => sanitizeLabel(account.label)))

  console.log(`[wallet-setup] generated ${accounts.length} setup file(s) in ${OUT_DIR}`)
}

function loadAccountsFromEnv(): AccountConfig[] {
  const accountsJson = (process.env.ACCOUNTS_JSON ?? '').trim()
  if (accountsJson) {
    const parsed = JSON.parse(accountsJson) as unknown
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    return rows.map((item, idx) => normalizeAccount(item as Record<string, unknown>, idx))
  }

  return [
    normalizeAccount(
      {
        label: 'env',
        proxy: process.env.PROXY ?? '',
        metamask_password: process.env.METAMASK_PASSWORD ?? '',
        metamask_seed_phrase: process.env.METAMASK_SEED_PHRASE || process.env.SRP || '',
        metamask_private_key: process.env.METAMASK_PRIVATE_KEY || process.env.PK || ''
      },
      0
    )
  ]
}

function normalizeAccount(raw: Record<string, unknown>, idx: number): AccountConfig {
  const label = sanitizeLabel(asString(raw.label || `acc${idx + 1}`))
  const metamaskPassword = asString(raw.metamask_password || raw.metamaskPassword || raw.password || '')
  const metamaskSeedPhrase = asString(raw.metamask_seed_phrase || raw.metamaskSeedPhrase || raw.srp || '')
  const metamaskPrivateKey = asString(raw.metamask_private_key || raw.metamaskPrivateKey || raw.pk || '')
  if (!metamaskPassword.trim()) throw new Error(`[${label}] metamask_password 为空`)
  if (!metamaskSeedPhrase.trim() && !metamaskPrivateKey.trim()) {
    throw new Error(`[${label}] 缺少 metamask_seed_phrase 或 metamask_private_key`)
  }
  return {
    label,
    proxy: asString(raw.proxy || ''),
    metamaskPassword,
    metamaskSeedPhrase,
    metamaskPrivateKey
  }
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return String(value)
}

function sanitizeLabel(label: string): string {
  const raw = (label ?? '').trim()
  const out = raw
    .split('')
    .map((ch) => (/^[a-z0-9._-]$/i.test(ch) ? ch : '_'))
    .join('')
    .replace(/^[._-]+|[._-]+$/g, '')
  return out || 'account'
}

async function cleanupOldSetupFiles(dirPath: string): Promise<void> {
  const entries = await readdir(dirPath).catch(() => [])
  await Promise.all(entries.filter((name) => name.endsWith('.setup.ts') || name === 'index.ts').map((name) => rm(path.join(dirPath, name), { force: true })))
}

async function writeGeneratedIndex(labels: string[]): Promise<void> {
  const pairs = labels.map((label, idx) => ({ label, varName: `${toIdentifier(label)}Setup${idx}` }))
  const imports = pairs.map(({ label, varName }) => `import ${varName} from './${label}.setup.js'`).join('\n')
  const entries = pairs.map(({ label, varName }) => `  ${JSON.stringify(label)}: ${varName}`).join(',\n')
  const content = `${imports}\n\nexport const walletSetupByLabel = {\n${entries}\n} as const\n`
  await writeFile(path.join(OUT_DIR, 'index.ts'), content, 'utf-8')
}

function toIdentifier(input: string): string {
  const cleaned = input.replace(/[^a-zA-Z0-9_]/g, '_')
  if (!cleaned) return 'acc'
  if (/^[0-9]/.test(cleaned)) return `acc_${cleaned}`
  return cleaned
}

function stableId(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12)
}

await main()
