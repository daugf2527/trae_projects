import { expect, test } from '@playwright/test'
import { loadAccounts } from '../../src/accounts.js'
import { resolveProxyForAccount } from '../../src/proxy.js'

test('loadAccounts 支持 srp/pk/email/invite_code 别名字段', () => {
  const prev = process.env.ACCOUNTS_JSON
  process.env.ACCOUNTS_JSON = JSON.stringify([
    {
      label: 'alias-case',
      metamask_password: 'pw123456',
      srp: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu',
      email: 'user@example.com',
      invite_code: 'INV123'
    }
  ])

  try {
    const [account] = loadAccounts()
    expect(account.label).toBe('alias-case')
    expect(account.metamaskSeedPhrase).toContain('alpha beta gamma')
    expect(account.emailAccount).toBe('user@example.com')
    expect(account.inviteCode).toBe('INV123')
  } finally {
    if (prev === undefined) {
      delete process.env.ACCOUNTS_JSON
    } else {
      process.env.ACCOUNTS_JSON = prev
    }
  }
})

test('resolveProxyForAccount 对同账号粘性复用并支持强制轮换', async () => {
  const prevUrl = process.env.PROXY_POOL_URL
  const prevTimeout = process.env.PROXY_POOL_TIMEOUT
  process.env.PROXY_POOL_URL = 'https://proxy-pool.test/proxy'
  process.env.PROXY_POOL_TIMEOUT = '2'

  const fetchCalls: string[] = []
  const pool = ['1.1.1.1:8001', '2.2.2.2:8002', '3.3.3.3:8003']
  const prevFetch = globalThis.fetch
  globalThis.fetch = (async (input: unknown) => {
    fetchCalls.push(String(input))
    const value = pool.shift() ?? '9.9.9.9:9999'
    return {
      ok: true,
      text: async () => value
    } as Response
  }) as typeof fetch

  try {
    const accountLabel = `case_${Date.now()}`
    const first = await resolveProxyForAccount('', { accountLabel })
    const second = await resolveProxyForAccount('', { accountLabel })
    const rotated = await resolveProxyForAccount('', { accountLabel, forceRotate: true })
    const afterRotate = await resolveProxyForAccount('', { accountLabel })

    expect(first?.server).toBe('http://1.1.1.1:8001')
    expect(second?.server).toBe('http://1.1.1.1:8001')
    expect(rotated?.server).toBe('http://2.2.2.2:8002')
    expect(afterRotate?.server).toBe('http://2.2.2.2:8002')
    expect(fetchCalls).toHaveLength(2)
  } finally {
    globalThis.fetch = prevFetch
    if (prevUrl === undefined) {
      delete process.env.PROXY_POOL_URL
    } else {
      process.env.PROXY_POOL_URL = prevUrl
    }
    if (prevTimeout === undefined) {
      delete process.env.PROXY_POOL_TIMEOUT
    } else {
      process.env.PROXY_POOL_TIMEOUT = prevTimeout
    }
  }
})
