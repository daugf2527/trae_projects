import { expect, test as baseTest } from '@playwright/test'
import path from 'node:path'
import { appendFile } from 'node:fs/promises'
import { defineWalletSetup } from '@synthetixio/synpress'
import * as synpressMetaMask from '@synthetixio/synpress-metamask/playwright'
import { createAnvil } from '@viem/anvil'
import { loadAccounts } from '../src/accounts.js'
import { sanitizeLabel, stableId, redactSecret } from '../src/utils.js'
import { parseProxy } from '../src/proxy.js'
import { LuckyXPage } from '../src/luckyxPage.js'
import { metaMaskFixturesWithProxy } from './fixtures/metaMaskFixturesWithProxy.js'

const { MetaMask: MetaMaskClass } = synpressMetaMask as unknown as {
  MetaMask: new (
    context: unknown,
    walletPage: unknown,
    password: string,
    extensionId?: string
  ) => { importWallet: (seedPhrase: string) => Promise<void>; importWalletFromPrivateKey: (privateKey: string) => Promise<void> }
}

let accounts: ReturnType<typeof loadAccounts> = []
let accountsLoadError: unknown
try {
  accounts = loadAccounts()
} catch (err) {
  accountsLoadError = err
}

if (accounts.length === 0) {
  baseTest('luckyx: 未配置账号，跳过', async () => {
    const reason = accountsLoadError instanceof Error ? accountsLoadError.message : '未配置账号'
    baseTest.skip(true, reason)
  })
}

for (const account of accounts) {
  const walletDiscriminator = stableId(
    `${account.label}|${account.metamaskSeedPhrase ?? ''}|${account.metamaskPrivateKey ?? ''}`
  )

  const walletSetupFn = (async (context: unknown, walletPage: unknown) => {
    const metamask = new MetaMaskClass(context, walletPage, account.metamaskPassword)
    const seedPhrase = (account.metamaskSeedPhrase ?? '').trim()
    const privateKey = (account.metamaskPrivateKey ?? '').trim()

    if (seedPhrase) {
      await metamask.importWallet(seedPhrase)
      return
    }
    if (privateKey) {
      await metamask.importWalletFromPrivateKey(privateKey)
      return
    }
    throw new Error(`[${account.label}] 缺少 metamask_seed_phrase 或 metamask_private_key`)
  }) as unknown as (context: unknown, walletPage: unknown) => Promise<void>

  Object.defineProperty(walletSetupFn, 'toString', {
    value: () =>
      `async function walletSetup(context, walletPage) { const walletDiscriminator = '${walletDiscriminator}'; void walletDiscriminator; }`
  })

  const walletSetup = defineWalletSetup(account.metamaskPassword, walletSetupFn)
  const test = metaMaskFixturesWithProxy(walletSetup, account.label, account.proxy ?? undefined)

  test(`${account.label}: 连接钱包并打开 LuckyX（邀请）`, async ({ page, metamask, artifactsDir }) => {
    const luckyx = new LuckyXPage(page)
    await writeAccountRunInfo(artifactsDir, account.label, account.proxy ?? '')

    await waitForPossibleCloudflare(page)
    await page.waitForLoadState('domcontentloaded')
    await capture(page, artifactsDir, '01-home')

    await luckyx.connect(metamask)
    await capture(page, artifactsDir, '02-connected')

    const address = await metamask.getAccountAddress()
    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)

    await luckyx.checkIn()
    await luckyx.bindEmail({
      emailAccount: account.emailAccount ?? '',
      emailPassword: account.emailPassword ?? '',
      emailImapServer: account.emailImapServer ?? ''
    })
    await luckyx.bindInvite(account.inviteCode ?? '')
  })

  test(`${account.label}: PoC 签名`, async ({ page, metamask, artifactsDir }) => {
    const luckyx = new LuckyXPage(page)
    await writeAccountRunInfo(artifactsDir, account.label, account.proxy ?? '')

    await waitForPossibleCloudflare(page)
    await page.waitForLoadState('domcontentloaded')
    await luckyx.connect(metamask)

    const signPromise = page.evaluate(async () => {
      const ethereum = (globalThis as any).ethereum as { request: (args: any) => Promise<unknown> }
      const accounts = (await ethereum.request({ method: 'eth_accounts' })) as string[]
      const from = accounts[0]
      const text = `luckyx-sign:${Date.now()}`
      const bytes = new TextEncoder().encode(text)
      let hex = '0x'
      for (const b of bytes) hex += b.toString(16).padStart(2, '0')
      return (await ethereum.request({
        method: 'personal_sign',
        params: [hex, from]
      })) as string
    })

    await metamask.confirmSignature()
    const signature = await signPromise
    expect(signature).toMatch(/^0x[0-9a-f]+$/i)
    await capture(page, artifactsDir, 'signed')
    await appendFile(path.join(artifactsDir, 'steps.log'), `signature=${signature.slice(0, 10)}...\n`)
  })

  test(`${account.label}: PoC 确认交易`, async ({ page, metamask, artifactsDir }) => {
    const seedPhrase = (account.metamaskSeedPhrase ?? '').trim()
    baseTest.skip(!seedPhrase, '需要 metamask_seed_phrase 才能在本地链发交易')

    const luckyx = new LuckyXPage(page)
    await writeAccountRunInfo(artifactsDir, account.label, account.proxy ?? '')

    const anvil = createAnvil({
      chainId: 1338,
      mnemonic: seedPhrase,
      balance: 10_000,
      accounts: 10
    })

    try {
      await anvil.start()
      const rpcUrl = `http://${anvil.host}:${anvil.port}`

      await waitForPossibleCloudflare(page)
      await page.waitForLoadState('domcontentloaded')
      await luckyx.connect(metamask)

      await metamask.addNetwork({
        name: 'Anvil',
        rpcUrl,
        chainId: 1338,
        symbol: 'ETH',
        blockExplorerUrl: 'https://etherscan.io/'
      }).catch(() => {})
      await metamask.switchNetwork('Anvil').catch(() => {})

      const txHashPromise = page.evaluate(async () => {
        const ethereum = (globalThis as any).ethereum as { request: (args: any) => Promise<unknown> }
        const accounts = (await ethereum.request({ method: 'eth_accounts' })) as string[]
        const from = accounts[0]
        return (await ethereum.request({
          method: 'eth_sendTransaction',
          params: [
            {
              from,
              to: from,
              value: '0x0'
            }
          ]
        })) as string
      })

      await metamask.confirmTransaction()
      const txHash = await txHashPromise
      expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
      await capture(page, artifactsDir, 'tx-submitted')

      const receipt = await waitForReceipt(rpcUrl, txHash, 60_000)
      expect(receipt?.status).toBe('0x1')
      await appendFile(path.join(artifactsDir, 'steps.log'), `txHash=${txHash}\n`)
    } finally {
      await anvil.stop().catch(() => {})
    }
  })
}

async function writeAccountRunInfo(artifactsDir: string, label: string, rawProxy: string): Promise<void> {
  const proxy = parseProxy(rawProxy)
  const server = proxy?.server ?? ''
  const username = proxy?.username ? redactSecret(proxy.username) : ''
  const password = proxy?.password ? redactSecret(proxy.password) : ''
  const line = `label=${sanitizeLabel(label)} proxy=${server} username=${username} password=${password}\n`
  await appendFile(path.join(artifactsDir, 'run.info'), line)
}

async function capture(page: import('@playwright/test').Page, artifactsDir: string, name: string): Promise<void> {
  await page.screenshot({ path: path.join(artifactsDir, `${name}.png`), fullPage: true }).catch(() => {})
}

async function waitForReceipt(
  rpcUrl: string,
  txHash: string,
  timeoutMs: number
): Promise<{ status?: string } | undefined> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const receipt = (await jsonRpc(rpcUrl, 'eth_getTransactionReceipt', [txHash])) as { status?: string } | null
    if (receipt) return receipt
    await new Promise((r) => setTimeout(r, 1_000))
  }
  return undefined
}

async function jsonRpc(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  })
  const json = (await res.json().catch(() => ({}))) as { result?: unknown }
  return json.result
}

async function waitForPossibleCloudflare(page: import('@playwright/test').Page): Promise<void> {
  const timeoutMs = 90_000
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const bodyText = (await page.locator('body').innerText().catch(() => '')).toLowerCase()
    const looksLikeChallenge =
      bodyText.includes('checking your browser') ||
      bodyText.includes('just a moment') ||
      bodyText.includes('cloudflare') ||
      bodyText.includes('验证') ||
      bodyText.includes('正在检查')
    if (!looksLikeChallenge) return
    await page.waitForTimeout(2_000)
  }
}





