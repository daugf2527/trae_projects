import { expect, test as baseTest } from '@playwright/test'
import path from 'node:path'
import { appendFile } from 'node:fs/promises'
import { createAnvil } from '@viem/anvil'
import { ImapFlow } from 'imapflow'
import { loadAccounts } from '../src/accounts.js'
import { sanitizeLabel, redactSecret } from '../src/utils.js'
import { resolveProxyForAccount } from '../src/proxy.js'
import { metaMaskFixturesWithProxy } from './fixtures/metaMaskFixturesWithProxy.js'
import type { ProxyConfig } from '../src/types.js'
import { walletSetupByLabel } from '../wallet-setup/generated/index.js'
import {
  detectChallengeSignals,
  getConnectButtonNamePatterns,
  getLoginButtonNamePatterns,
  looksLikeMigrationModal
} from '../src/luckyxSignals.js'

type StepStatus = {
  attempted: boolean
  success: boolean
  reason: string
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
  const walletSetup = walletSetupByLabel[account.label as keyof typeof walletSetupByLabel]
  if (!walletSetup) {
    throw new Error(
      [
        `[${account.label}] 未找到对应 wallet setup。`,
        '请先执行：npm run wallet:cache（enterprise_pw 目录）',
        '或：npm --prefix enterprise_pw run wallet:cache（仓库根目录）'
      ].join('\n')
    )
  }
  const test = metaMaskFixturesWithProxy(walletSetup, account.label, account.proxy ?? undefined)

  test(`${account.label}: 连接钱包并打开 LuckyX`, async ({ page, metamask, artifactsDir, resolvedProxy }) => {
    await writeAccountRunInfo(artifactsDir, account.label, resolvedProxy, account.proxy ?? '')

    await runStep(artifactsDir, 'wait_challenge', async () => waitForPossibleCloudflare(page))
    await page.waitForLoadState('domcontentloaded')
    await capture(page, artifactsDir, '01-home')

    await runStep(artifactsDir, 'connect_wallet', async () => connectLuckyX(page, metamask))
    await capture(page, artifactsDir, '02-connected')

    const address = await metamask.getAccountAddress()
    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)

    const checkInStatus = await runStep(artifactsDir, 'daily_check_in', async () => tryDailyCheckIn(page))
    if (checkInStatus.attempted) {
      expect(checkInStatus.success, `[${account.label}] daily_check_in 失败: ${checkInStatus.reason}`).toBe(true)
    }

    const emailStatus = await runStep(artifactsDir, 'bind_email', async () =>
      tryBindEmail(page, {
        emailAccount: account.emailAccount ?? '',
        emailPassword: account.emailPassword ?? '',
        emailImapServer: account.emailImapServer ?? ''
      })
    )
    if (hasEmailBindCredentials(account)) {
      expect(emailStatus.success, `[${account.label}] bind_email 失败: ${emailStatus.reason}`).toBe(true)
    }
  })

  test(`${account.label}: PoC 签名`, async ({ page, metamask, artifactsDir, resolvedProxy }) => {
    await writeAccountRunInfo(artifactsDir, account.label, resolvedProxy, account.proxy ?? '')

    await runStep(artifactsDir, 'wait_challenge', async () => waitForPossibleCloudflare(page))
    await page.waitForLoadState('domcontentloaded')
    await runStep(artifactsDir, 'connect_wallet', async () => connectLuckyX(page, metamask))

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

    await runStep(artifactsDir, 'confirm_signature', async () => metamask.confirmSignature())
    const signature = await signPromise
    expect(signature).toMatch(/^0x[0-9a-f]+$/i)
    await capture(page, artifactsDir, 'signed')
    await appendFile(path.join(artifactsDir, 'steps.log'), `signature=${signature.slice(0, 10)}...\n`)
  })

  test(`${account.label}: PoC 确认交易`, async ({ page, metamask, artifactsDir, resolvedProxy }) => {
    const seedPhrase = (account.metamaskSeedPhrase ?? '').trim()
    baseTest.skip(!seedPhrase, '需要 metamask_seed_phrase 才能在本地链发交易')

    await writeAccountRunInfo(artifactsDir, account.label, resolvedProxy, account.proxy ?? '')

    const anvil = createAnvil({
      chainId: 1338,
      mnemonic: seedPhrase,
      balance: 10_000,
      accounts: 10
    })

    try {
      await anvil.start()
      const rpcUrl = `http://${anvil.host}:${anvil.port}`

      await runStep(artifactsDir, 'wait_challenge', async () => waitForPossibleCloudflare(page))
      await page.waitForLoadState('domcontentloaded')
      await runStep(artifactsDir, 'connect_wallet', async () => connectLuckyX(page, metamask))

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

      await runStep(artifactsDir, 'confirm_transaction', async () => metamask.confirmTransaction())
      const txHash = await txHashPromise
      expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
      await capture(page, artifactsDir, 'tx-submitted')

      const receipt = await runStep(artifactsDir, 'wait_receipt', async () => waitForReceipt(rpcUrl, txHash, 60_000))
      expect(receipt?.status).toBe('0x1')
      await appendFile(path.join(artifactsDir, 'steps.log'), `txHash=${txHash}\n`)
    } finally {
      await anvil.stop().catch(() => {})
    }
  })
}

async function writeAccountRunInfo(
  artifactsDir: string,
  label: string,
  resolvedProxy?: ProxyConfig,
  rawProxy?: string
): Promise<void> {
  const proxy = resolvedProxy ?? (await resolveProxyForAccount(rawProxy, { accountLabel: label }))
  const server = proxy?.server ?? ''
  const username = proxy?.username ? redactSecret(proxy.username) : ''
  const password = proxy?.password ? redactSecret(proxy.password) : ''
  const line = `ts=${new Date().toISOString()} label=${sanitizeLabel(label)} proxy=${server} username=${username} password=${password}\n`
  await appendFile(path.join(artifactsDir, 'run.info'), line)
}

async function runStep<T>(artifactsDir: string, step: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now()
  await appendFile(path.join(artifactsDir, 'steps.log'), `[${new Date().toISOString()}] ${step} start\n`)
  try {
    const result = await fn()
    const cost = Date.now() - start
    await appendFile(path.join(artifactsDir, 'steps.log'), `[${new Date().toISOString()}] ${step} ok ${cost}ms\n`)
    return result
  } catch (error) {
    const cost = Date.now() - start
    const msg = error instanceof Error ? error.message : String(error)
    await appendFile(path.join(artifactsDir, 'steps.log'), `[${new Date().toISOString()}] ${step} fail ${cost}ms ${msg}\n`)
    throw error
  }
}

async function capture(page: import('@playwright/test').Page, artifactsDir: string, name: string): Promise<void> {
  await page.screenshot({ path: path.join(artifactsDir, `${name}.png`), fullPage: true }).catch(() => {})
}

async function connectLuckyX(page: import('@playwright/test').Page, metamask: any): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  await page.waitForTimeout(1_500)

  const title = await page.title().catch(() => '')
  if (!title || title.toLowerCase().includes('metamask')) {
    await page.goto('/').catch(() => {})
    await page.waitForLoadState('domcontentloaded').catch(() => {})
    await page.waitForTimeout(1_500)
  }

  await dismissMigrationModal(page)
  await waitForPossibleCloudflare(page)

  const metamaskCandidates = [
    page.getByRole('button', { name: /metamask/i }).first(),
    page.getByText(/metamask/i).first(),
    page.locator('.web3modal-provider-name').filter({ hasText: /metamask/i }).first(),
    page.getByRole('button', { name: /browser wallet/i }).first(),
    page.getByText(/browser wallet/i).first()
  ]

  if (!(await hasAnyVisibleLocator(metamaskCandidates))) {
    const connectCandidates = [
      ...getConnectButtonNamePatterns().map((pattern) => page.getByRole('button', { name: pattern }).first()),
      page.locator('button:has-text("Connect Wallet")').first(),
      page.locator('button:has-text("连接钱包")').first(),
      page.getByText(/connect wallet|连接钱包/i).first()
    ]

    const connectClicked = await clickFirstVisibleLocator(connectCandidates)
    if (connectClicked) {
      await page.waitForTimeout(1_000)
      await dismissMigrationModal(page)
      await waitForPossibleCloudflare(page)
    }
  }

  // 某些页面需要先点 Login 才会出现 Connect Wallet/MetaMask 选项
  if (!(await hasAnyVisibleLocator(metamaskCandidates))) {
    const loginCandidates = [
      ...getLoginButtonNamePatterns().map((pattern) => page.getByRole('button', { name: pattern }).first()),
      page.getByText(/login|log in|sign in|登录/i).first()
    ]
    const loginClicked = await clickFirstVisibleLocator(loginCandidates)
    if (loginClicked) {
      await dismissMigrationModal(page)
      await waitForPossibleCloudflare(page)
      await page.waitForTimeout(700)
    }
  }

  // login 后再尝试一次 connect wallet
  if (!(await hasAnyVisibleLocator(metamaskCandidates))) {
    const connectCandidates = [
      ...getConnectButtonNamePatterns().map((pattern) => page.getByRole('button', { name: pattern }).first()),
      page.locator('button:has-text("Connect Wallet")').first(),
      page.locator('button:has-text("连接钱包")').first(),
      page.getByText(/connect wallet|连接钱包/i).first()
    ]
    const connectClicked = await clickFirstVisibleLocator(connectCandidates)
    if (connectClicked) {
      await page.waitForTimeout(1_000)
      await dismissMigrationModal(page)
      await waitForPossibleCloudflare(page)
    }
  }

  if (!(await hasAnyVisibleLocator(metamaskCandidates))) {
    const debug = await collectVisibleButtonTexts(page)
    throw new Error(
      [
        '[LuckyX] 未找到连接钱包按钮或 MetaMask 选项',
        `url=${page.url()}`,
        `title=${await page.title().catch(() => '')}`,
        `visible_buttons=${debug.join(' | ') || '(none)'}`
      ].join('\n')
    )
  }

  const metamaskClicked = await clickFirstVisibleLocator(metamaskCandidates, { force: true })
  if (!metamaskClicked) {
    const debug = await collectVisibleButtonTexts(page)
    throw new Error(
      [
        '[LuckyX] 未找到 MetaMask 选项',
        `url=${page.url()}`,
        `visible_buttons=${debug.join(' | ') || '(none)'}`
      ].join('\n')
    )
  }

  await metamask.connectToDapp()
}

async function clickFirstVisibleLocator(
  candidates: import('@playwright/test').Locator[],
  options?: { force?: boolean }
): Promise<boolean> {
  for (const candidate of candidates) {
    const locator = candidate.first()
    const visible = await locator.isVisible().catch(() => false)
    if (!visible) continue
    const enabled = await locator.isEnabled().catch(() => true)
    if (!enabled) continue
    const clicked = await locator
      .click({ timeout: 5_000, force: options?.force === true })
      .then(() => true)
      .catch(() => false)
    if (clicked) return true
  }
  return false
}

async function hasAnyVisibleLocator(candidates: import('@playwright/test').Locator[]): Promise<boolean> {
  for (const candidate of candidates) {
    if (await candidate.first().isVisible().catch(() => false)) return true
  }
  return false
}

async function collectVisibleButtonTexts(page: import('@playwright/test').Page): Promise<string[]> {
  const buttons = await page.getByRole('button').all().catch(() => [])
  const out: string[] = []
  for (const button of buttons.slice(0, 25)) {
    const visible = await button.isVisible().catch(() => false)
    if (!visible) continue
    const text = (await button.innerText().catch(() => '')).trim().replace(/\s+/g, ' ')
    if (text) out.push(text)
  }
  return out
}

async function dismissMigrationModal(page: import('@playwright/test').Page): Promise<void> {
  const bodyText = await page.locator('body').innerText().catch(() => '')
  if (!looksLikeMigrationModal(bodyText)) return

  const closeCandidates = [
    page.getByRole('button', { name: /close|关闭|skip|later/i }).first(),
    page.locator('button[aria-label*="close" i]').first(),
    page.locator('button:has-text("×")').first(),
    page.locator('button:has-text("✕")').first(),
    page.locator('[class*="close"]').first()
  ]
  await clickFirstVisibleLocator(closeCandidates, { force: true })
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(500)
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
  const timeoutMs = resolveChallengeWaitTimeoutMs()
  const capsolverApiKey = (process.env.CAPSOLVER_API_KEY ?? '').trim()
  const start = Date.now()
  let logged = false
  while (Date.now() - start < timeoutMs) {
    if (page.isClosed()) {
      throw new Error('页面已关闭，验证码等待被中断（可能是外层测试超时）')
    }

    const [bodyText, html] = await Promise.all([
      page.locator('body').innerText().catch(() => ''),
      page.content().catch(() => '')
    ])
    const signals = detectChallengeSignals({ bodyText, html })
    const turnstileFrameVisible = await page
      .locator('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]')
      .first()
      .isVisible()
      .catch(() => false)
    const recaptchaFrameVisible = await page
      .locator('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"]')
      .first()
      .isVisible()
      .catch(() => false)
    const turnstileContainerVisible = await page
      .locator('.cf-turnstile, [data-sitekey][class*="turnstile"], [id*="turnstile"]')
      .first()
      .isVisible()
      .catch(() => false)

    const hasChallenge =
      signals.looksLikeCloudflareInterstitial || turnstileFrameVisible || recaptchaFrameVisible || turnstileContainerVisible

    if (!hasChallenge) {
      if (logged) console.log('[Challenge] verification passed')
      return
    }
    if (!logged) {
      const types = [
        signals.hasTurnstile ? 'turnstile' : '',
        signals.hasRecaptcha ? 'recaptcha' : '',
        signals.looksLikeCloudflareInterstitial ? 'cloudflare' : ''
      ]
        .filter(Boolean)
        .join('+')
      console.log(
        `[Challenge] detected (${types || 'unknown'}), waiting for manual solve (<=${Math.floor(timeoutMs / 1000)}s)`
      )
      if (!capsolverApiKey) {
        console.warn('[Challenge] CAPSOLVER_API_KEY is empty; extension can load but will not auto-solve.')
      }
      logged = true
    }

    if (turnstileFrameVisible) {
      const turnstileFrame = page.frameLocator('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]').first()
      await turnstileFrame
        .locator('input[type="checkbox"], .ctp-checkbox-label')
        .first()
        .click({ timeout: 1_000 })
        .catch(() => {})
    }

    await dismissMigrationModal(page)
    await page.waitForTimeout(2_000)
  }
  throw new Error(`验证码未在 ${Math.floor(timeoutMs / 1000)} 秒内完成，请手动完成验证后重试`)
}

function resolveChallengeWaitTimeoutMs(): number {
  const fromEnv = Number((process.env.CHALLENGE_WAIT_TIMEOUT_MS ?? '').trim())
  if (Number.isFinite(fromEnv) && fromEnv >= 15_000) return Math.floor(fromEnv)
  return 180_000
}

function hasEmailBindCredentials(account: {
  emailAccount?: string
  emailPassword?: string
  emailImapServer?: string
}): boolean {
  return Boolean(account.emailAccount?.trim() && account.emailPassword?.trim() && account.emailImapServer?.trim())
}

async function tryDailyCheckIn(page: import('@playwright/test').Page): Promise<StepStatus> {
  const candidates = [
    page.getByRole('button', { name: /签到|check[- ]?in/i }),
    page.getByText(/签到|check[- ]?in/i),
    page.getByRole('link', { name: /签到|check[- ]?in/i })
  ]
  for (const locator of candidates) {
    const first = locator.first()
    if (await first.isVisible().catch(() => false)) {
      const clicked = await first.click({ timeout: 5_000 }).then(() => true).catch(() => false)
      if (!clicked) {
        return { attempted: true, success: false, reason: 'checkin_button_click_failed' }
      }
      await page.waitForTimeout(1_000)
      return { attempted: true, success: true, reason: 'checkin_clicked' }
    }
  }
  return { attempted: false, success: true, reason: 'checkin_button_not_found' }
}

async function tryBindEmail(
  page: import('@playwright/test').Page,
  input: { emailAccount: string; emailPassword: string; emailImapServer: string }
): Promise<StepStatus> {
  const email = input.emailAccount.trim()
  if (!email) return { attempted: false, success: true, reason: 'email_not_configured' }
  if (!input.emailPassword.trim() || !input.emailImapServer.trim()) {
    return { attempted: true, success: false, reason: 'email_credentials_incomplete' }
  }

  const openProfileCandidates = [
    page.getByRole('button', { name: /profile|account|设置|我的/i }),
    page.getByRole('link', { name: /profile|account|设置|我的/i }),
    page.getByText(/profile|account|设置|我的/i)
  ]
  for (const locator of openProfileCandidates) {
    const first = locator.first()
    if (await first.isVisible().catch(() => false)) {
      await first.click({ timeout: 5_000 }).catch(() => {})
      break
    }
  }

  const emailFieldCandidates = [
    page.getByLabel(/email/i),
    page.getByPlaceholder(/email/i),
    page.locator('input[type="email"]')
  ]

  let emailField: import('@playwright/test').Locator | undefined
  for (const locator of emailFieldCandidates) {
    const first = locator.first()
    if (await first.isVisible().catch(() => false)) {
      emailField = first
      break
    }
  }
  if (!emailField) return { attempted: true, success: false, reason: 'email_input_not_found' }

  const emailFilled = await emailField.fill(email).then(() => true).catch(() => false)
  if (!emailFilled) return { attempted: true, success: false, reason: 'email_fill_failed' }

  const sendCodeButton = page.getByRole('button', { name: /send|code|验证码|获取验证码/i }).first()
  if (!(await sendCodeButton.isVisible().catch(() => false))) {
    return { attempted: true, success: false, reason: 'send_code_button_not_found' }
  }
  const sendClicked = await sendCodeButton.click().then(() => true).catch(() => false)
  if (!sendClicked) return { attempted: true, success: false, reason: 'send_code_click_failed' }

  const code = await fetchLatestVerificationCodeImap({
    emailAccount: input.emailAccount,
    emailPassword: input.emailPassword,
    emailImapServer: input.emailImapServer
  }).catch(() => '')

  if (!code) return { attempted: true, success: false, reason: 'verification_code_not_found' }

  const codeFieldCandidates = [
    page.getByLabel(/code|验证码/i),
    page.getByPlaceholder(/code|验证码/i),
    page.locator('input[inputmode="numeric"]')
  ]
  let codeFilled = false
  for (const locator of codeFieldCandidates) {
    const first = locator.first()
    if (await first.isVisible().catch(() => false)) {
      codeFilled = await first.fill(code).then(() => true).catch(() => false)
      break
    }
  }
  if (!codeFilled) return { attempted: true, success: false, reason: 'code_input_not_found_or_fill_failed' }

  const confirmButton = page.getByRole('button', { name: /confirm|bind|verify|确认|绑定|验证/i }).first()
  if (!(await confirmButton.isVisible().catch(() => false))) {
    return { attempted: true, success: false, reason: 'email_confirm_button_not_found' }
  }
  const confirmed = await confirmButton.click().then(() => true).catch(() => false)
  if (!confirmed) return { attempted: true, success: false, reason: 'email_confirm_click_failed' }
  return { attempted: true, success: true, reason: 'email_bind_submitted' }
}

async function fetchLatestVerificationCodeImap(input: {
  emailAccount: string
  emailPassword: string
  emailImapServer: string
}): Promise<string> {
  const user = input.emailAccount.trim()
  const pass = input.emailPassword.trim()
  const serverRaw = input.emailImapServer.trim()
  if (!user || !pass || !serverRaw) return ''

  const { host, port } = parseImapServer(serverRaw)
  const client = new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: { user, pass },
    logger: false
  })

  try {
    await client.connect()
    await client.mailboxOpen('INBOX')
    const since = new Date(Date.now() - 15 * 60 * 1000)
    const uids = await client.search({ since })
    if (uids === false) return ''
    const list = Array.from(uids)
    const latest = list.sort((a: number, b: number) => b - a)[0]
    if (!latest) return ''
    const msg = await client.fetchOne(latest, { source: true })
    if (msg === false) return ''
    const raw = msg.source?.toString('utf8') ?? ''
    const match = raw.match(/\b(\d{6})\b/)
    return match?.[1] ?? ''
  } finally {
    await client.logout().catch(() => {})
  }
}

function parseImapServer(server: string): { host: string; port: number } {
  const s = server.trim().replace(/^imaps?:\/\//, '')
  const idx = s.lastIndexOf(':')
  if (idx > 0 && idx < s.length - 1) {
    const host = s.slice(0, idx)
    const port = Number(s.slice(idx + 1))
    if (host && Number.isFinite(port) && port > 0) return { host, port }
  }
  return { host: s, port: 993 }
}
