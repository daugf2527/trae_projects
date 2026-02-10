import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parse } from 'csv-parse/sync'
import dotenv from 'dotenv'
import type { AccountConfig } from './types.js'
import { sanitizeLabel } from './utils.js'

dotenv.config({ path: path.resolve(process.cwd(), '../luckyx_automation/.env') })
dotenv.config()

function asString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return String(value)
}

function getEnv(name: string): string {
  return asString(process.env[name]).trim()
}

function requireOneOf(values: Array<{ name: string; value: string }>): void {
  if (values.some((v) => v.value.trim())) return
  throw new Error(`缺少必要字段：${values.map((v) => v.name).join(' 或 ')}`)
}

export function loadAccounts(): AccountConfig[] {
  const accountsJson = getEnv('ACCOUNTS_JSON')
  if (accountsJson) {
    const parsed = JSON.parse(accountsJson) as unknown
    const items = Array.isArray(parsed) ? parsed : [parsed]
    return items.map((item, idx) => normalizeAccount(item as Record<string, unknown>, idx))
  }

  const accountsFile = getEnv('ACCOUNTS_FILE')
  if (accountsFile) {
    const abs = path.isAbsolute(accountsFile) ? accountsFile : path.resolve(process.cwd(), '..', accountsFile)
    const content = fs.readFileSync(abs, 'utf-8')
    const records = parse(content, { columns: true, skip_empty_lines: true, bom: true }) as Array<Record<string, string>>
    return records.map((row, idx) => normalizeAccount(row as unknown as Record<string, unknown>, idx))
  }

  const fallback = normalizeAccount(
    {
      label: 'env',
      proxy: getEnv('PROXY'),
      metamask_password: getEnv('METAMASK_PASSWORD'),
      metamask_seed_phrase: getEnv('METAMASK_SEED_PHRASE') || getEnv('SRP'),
      metamask_private_key: getEnv('METAMASK_PRIVATE_KEY') || getEnv('PK'),
      email_account: getEnv('EMAIL_ACCOUNT'),
      email_password: getEnv('EMAIL_PASSWORD'),
      email_imap_server: getEnv('EMAIL_IMAP_SERVER'),
      invite_code: getEnv('INVITE_CODE')
    },
    0
  )
  return [fallback]
}

function normalizeAccount(raw: Record<string, unknown>, idx: number): AccountConfig {
  const label = sanitizeLabel(asString(raw.label || `acc${idx + 1}`))
  const cfg: AccountConfig = {
    label,
    proxy: asString(raw.proxy || ''),
    metamaskPassword: asString(raw.metamask_password || raw.metamaskPassword || raw.password || ''),
    metamaskSeedPhrase: asString(raw.metamask_seed_phrase || raw.metamaskSeedPhrase || raw.srp || raw.seed_phrase || ''),
    metamaskPrivateKey: asString(raw.metamask_private_key || raw.metamaskPrivateKey || raw.pk || raw.private_key || ''),
    emailAccount: asString(raw.email_account || raw.emailAccount || raw.email || ''),
    emailPassword: asString(raw.email_password || raw.emailPassword || ''),
    emailImapServer: asString(raw.email_imap_server || raw.emailImapServer || ''),
    inviteCode: asString(raw.invite_code || raw.inviteCode || raw.invite || '')
  }

  if (!cfg.metamaskPassword.trim()) throw new Error(`[${label}] metamask_password 为空`)
  requireOneOf([
    { name: 'metamask_seed_phrase', value: cfg.metamaskSeedPhrase ?? '' },
    { name: 'metamask_private_key', value: cfg.metamaskPrivateKey ?? '' }
  ])

  return cfg
}
