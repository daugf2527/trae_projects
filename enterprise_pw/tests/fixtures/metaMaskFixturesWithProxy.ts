import path from 'node:path'
import { chromium, test as base, type BrowserContext, type Page } from '@playwright/test'
import { access, cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import * as synpressCache from '@synthetixio/synpress-cache'
import * as synpressMetaMask from '@synthetixio/synpress-metamask/playwright'
import { resolveProxyForAccount } from '../../src/proxy.js'
import type { ProxyConfig } from '../../src/types.js'
import { sanitizeLabel } from '../../src/utils.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const CAPSOLVER_EXTENSION_PATHS = [
  path.join(process.cwd(), 'extensions', 'capsolver'),
  path.join(process.cwd(), 'enterprise_pw', 'extensions', 'capsolver'),
  path.resolve(__dirname, '../../extensions/capsolver')
]

dotenv.config({ path: path.resolve(process.cwd(), '../luckyx_automation/.env') })
dotenv.config()

const RESOLVED_PROXY = Symbol('resolved_proxy')
const TRACE_STARTED = Symbol('trace_started')
const METAMASK_PAGE = Symbol('metamask_page')
const METAMASK_EXTENSION_ID = Symbol('metamask_extension_id')

type ContextWithMetaMaskState = BrowserContext & {
  [RESOLVED_PROXY]?: ProxyConfig
  [TRACE_STARTED]?: boolean
  [METAMASK_PAGE]?: Page
  [METAMASK_EXTENSION_ID]?: string
}

function getBrowserLocale(): string {
  return (process.env.BROWSER_LOCALE ?? 'en-US').trim() || 'en-US'
}

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

async function getCapsolverPath(): Promise<string | null> {
  for (const candidate of CAPSOLVER_EXTENSION_PATHS) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // try next candidate
    }
  }
  return null
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function prepareCapsolverExtension(
  contextDirPath: string,
  proxy?: ProxyConfig
): Promise<string | null> {
  const basePath = await getCapsolverPath()
  if (!basePath) return null

  const tempPath = path.join(contextDirPath, 'capsolver-extension')
  await rm(tempPath, { recursive: true, force: true }).catch(() => {})
  await cp(basePath, tempPath, { recursive: true, force: true })

  const apiKey = (process.env.CAPSOLVER_API_KEY ?? '').trim()
  const proxyServer = (proxy?.server ?? '').trim()

  const configPath = path.join(tempPath, 'assets', 'config.js')
  try {
    const content = await readFile(configPath, 'utf-8')
    let next = content
    if (apiKey) {
      next = next.replace(/apiKey:\s*['"][^'"]*['"]/, `apiKey: '${apiKey}'`)
    }

    if (proxyServer) {
      const url = new URL(proxyServer)
      const proxyType = (url.protocol || 'http:').replace(':', '')
      const hostOrIp = url.hostname
      const port = url.port
      const proxyLogin = (proxy?.username ?? '').trim()
      const proxyPassword = (proxy?.password ?? '').trim()

      next = next.replace(/useProxy:\s*(true|false)/, 'useProxy: true')
      next = next.replace(/proxyType:\s*['"][^'"]*['"]/, `proxyType: '${proxyType}'`)
      next = next.replace(/hostOrIp:\s*['"][^'"]*['"]/, `hostOrIp: '${hostOrIp}'`)
      next = next.replace(/port:\s*['"][^'"]*['"]/, `port: '${port}'`)
      next = next.replace(/proxyLogin:\s*['"][^'"]*['"]/, `proxyLogin: '${proxyLogin}'`)
      next = next.replace(/proxyPassword:\s*['"][^'"]*['"]/, `proxyPassword: '${proxyPassword}'`)
    }
    if (!next.endsWith('\n')) next += '\n'
    if (next !== content) await writeFile(configPath, next, 'utf-8')
  } catch (e) {
    console.warn(`Failed to configure CapSolver extension: ${e}`)
  }

  return tempPath
}

const { CACHE_DIR_NAME, createTempContextDir, defineWalletSetup, prepareExtension, removeTempContextDir } =
  synpressCache as unknown as {
    CACHE_DIR_NAME: string
    createTempContextDir: (browserName: string, testId: string) => Promise<string>
    defineWalletSetup: (
      walletPassword: string,
      fn: (context: BrowserContext, walletPage: Page) => Promise<void>
    ) => { hash: string; fn: (context: BrowserContext, walletPage: Page) => Promise<void>; walletPassword: string }
    prepareExtension: () => Promise<string>
    removeTempContextDir: (contextPath: string) => Promise<unknown>
  }

// Custom getExtensionId with retry logic - Synpress's version fails on some Chromium builds
async function getExtensionIdWithRetry(context: BrowserContext, extensionName: string): Promise<string> {
  const page = await context.newPage()
  await page.goto('chrome://extensions')

  let extensions: Array<{ id: string; name: string }> | null = null
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await page.waitForTimeout(1_000)
      const result = await page.evaluate(`
        (typeof chrome !== 'undefined' && chrome.management && typeof chrome.management.getAll === 'function')
          ? chrome.management.getAll()
          : null
      `)
      if (result && Array.isArray(result) && result.length > 0) {
        extensions = result as Array<{ id: string; name: string }>
        break
      }
      console.log(`[getExtensionId] Attempt ${attempt + 1}: chrome.management.getAll() returned empty or null, retrying...`)
    } catch (e) {
      console.log(`[getExtensionId] Attempt ${attempt + 1}: ${e}, retrying...`)
    }
    if (attempt < 9) await page.reload()
  }

  await page.close()

  if (!extensions || extensions.length === 0) {
    throw new Error(`[getExtensionId] chrome.management.getAll() failed after 10 retries`)
  }

  const target = extensions.find(ext => ext.name.toLowerCase() === extensionName.toLowerCase())
  if (!target) {
    throw new Error(
      `[getExtensionId] Extension "${extensionName}" not found. Available: ${extensions.map(e => e.name).join(', ')}`
    )
  }
  console.log(`[getExtensionId] Found ${extensionName} with ID: ${target.id}`)
  return target.id
}

async function listExtensions(context: BrowserContext): Promise<Array<{ id: string; name: string }>> {
  const page = await context.newPage()
  try {
    await page.goto('chrome://extensions')
    await page.waitForTimeout(600)
    const result = await page.evaluate(`
      (typeof chrome !== 'undefined' && chrome.management && typeof chrome.management.getAll === 'function')
        ? chrome.management.getAll()
        : []
    `)
    if (!result || !Array.isArray(result)) return []
    return result.map((item) => ({ id: String(item.id ?? ''), name: String(item.name ?? '') }))
  } catch {
    return []
  } finally {
    await page.close().catch(() => {})
  }
}

async function ensureMetaMaskUnlocked(page: Page, walletPassword: string): Promise<void> {
  if (!walletPassword.trim()) return
  if (!(await looksLikeMetaMaskUnlock(page))) return

  await unlockForFixture(page, walletPassword).catch(() => {})
  await page.waitForTimeout(500)
  if (!(await looksLikeMetaMaskUnlock(page))) return

  const passwordInputCandidates = [
    page.getByTestId('unlock-password').first(),
    page.locator('input[type="password"]').first(),
    page.getByPlaceholder(/password|密码/i).first()
  ]

  let filled = false
  for (const candidate of passwordInputCandidates) {
    const visible = await candidate.isVisible().catch(() => false)
    if (!visible) continue
    await candidate.fill(walletPassword).catch(() => {})
    filled = true
    break
  }

  const unlockButtonCandidates = [
    page.getByTestId('unlock-submit').first(),
    page.getByRole('button', { name: /unlock|log in|login|登录|解锁/i }).first(),
    page.locator('button[type="submit"]').first()
  ]

  for (const candidate of unlockButtonCandidates) {
    const visible = await candidate.isVisible().catch(() => false)
    if (!visible) continue
    const enabled = await candidate.isEnabled().catch(() => true)
    if (!enabled) continue
    await candidate.click({ timeout: 3_000 }).catch(() => {})
    break
  }

  await page.waitForTimeout(1_000)
  if (await looksLikeMetaMaskUnlock(page)) {
    throw new Error(
      [
        'MetaMask 仍处于解锁页，自动解锁失败。',
        `password_input_filled=${filled ? 'yes' : 'no'}`,
        '请确认 METAMASK_PASSWORD 与钱包缓存一致（必要时执行 npm --prefix enterprise_pw run wallet:cache:force 重新生成）。'
      ].join('\n')
    )
  }
}

async function looksLikeMetaMaskUnlock(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase()
  if (url.includes('/unlock') || url.includes('onboarding/unlock')) return true

  const passwordInput = await page.locator('input[type="password"]').first().isVisible().catch(() => false)
  if (!passwordInput) return false

  const bodyText = await page.locator('body').innerText().catch(() => '')
  return /forgot password|unlock|log in|login|忘记密码|登录|解锁/i.test(bodyText)
}

const { unlockForFixture, MetaMask: MetaMaskClass } = synpressMetaMask as unknown as {
  unlockForFixture: (page: Page, walletPassword: string) => Promise<void>
  MetaMask: new (context: BrowserContext, page: Page, password: string, extensionId?: string) => {
    addNetwork: (network: {
      name: string
      rpcUrl: string
      chainId: number
      symbol: string
      blockExplorerUrl?: string
    }) => Promise<void>
    connectToDapp: (accounts?: string[]) => Promise<void>
    confirmSignature: () => Promise<void>
    confirmTransaction: (options?: { gasSetting?: unknown }) => Promise<void>
    getAccountAddress: () => Promise<string>
    switchNetwork: (networkName: string, isTestnet?: boolean) => Promise<void>
  }
}

type MetaMask = InstanceType<typeof MetaMaskClass>

type MetaMaskFixtures = {
  _contextPath: string
  metamask: MetaMask
  extensionId: string
  metamaskPage: Page
  artifactsDir: string
  resolvedProxy?: ProxyConfig
}

export function metaMaskFixturesWithProxy(
  walletSetup: ReturnType<typeof defineWalletSetup>,
  accountLabel: string,
  accountProxy?: string,
  slowMo = 0
) {
  return base.extend<MetaMaskFixtures>({
    artifactsDir: async ({}, use, testInfo) => {
      const dir = path.join(process.cwd(), 'artifacts', sanitizeLabel(accountLabel), testInfo.testId)
      await mkdir(dir, { recursive: true })
      await use(dir)
    },
    _contextPath: async ({ browserName }, use, testInfo) => {
      const contextPath = await createTempContextDir(browserName, testInfo.testId)
      await use(contextPath)
      const error = await removeTempContextDir(contextPath)
      if (error) console.error(error)
    },
    context: async ({ context: currentContext, _contextPath, artifactsDir }, use, testInfo) => {
      const { hash, walletPassword } = walletSetup
      const launchRetries = getPositiveInt(process.env.PROXY_LAUNCH_RETRIES, 2)
      const launchBackoffMs = getPositiveInt(process.env.PROXY_LAUNCH_BACKOFF_MS, 1_000)
      const browserLocale = getBrowserLocale()

      const cacheDirPath = path.join(process.cwd(), CACHE_DIR_NAME, hash)
      if (!(await pathExists(cacheDirPath))) {
        throw new Error(
          [
            `[${accountLabel}] 未找到 Synpress cache: ${cacheDirPath}`,
            '请先执行缓存构建：npm run wallet:cache（在 enterprise_pw 目录下）',
            '或：npm --prefix enterprise_pw run wallet:cache（在仓库根目录下）'
          ].join('\n')
        )
      }

      let context: BrowserContext | undefined
      let selectedProxy: ProxyConfig | undefined
      let lastError: unknown
      for (let attempt = 1; attempt <= launchRetries; attempt += 1) {
        selectedProxy = (await resolveProxyForAccount(accountProxy, {
          accountLabel,
          forceRotate: attempt > 1
        })) as ProxyConfig | undefined

        try {
          context = await launchPersistentContextForRun({
            currentContext,
            contextPath: _contextPath,
            cacheDirPath,
            proxy: selectedProxy,
            slowMo,
            locale: browserLocale
          })

          const extensionId = await getExtensionIdWithRetry(context, 'MetaMask')
          const loadedExtensions = await listExtensions(context)
          const hasCapsolver = loadedExtensions.some((item) => /capsolver|captcha solver/i.test(item.name))
          console.log(`[Extensions] ${loadedExtensions.map((item) => item.name).join(', ')}`)
          if (!hasCapsolver) {
            console.warn('[CapSolver] extension is not listed in chrome.management')
          }
          const metamaskPage = (context.pages()[0] as Page | undefined) ?? (await context.newPage())
          await metamaskPage.goto(`chrome-extension://${extensionId}/home.html`)
          await metamaskPage.waitForLoadState('domcontentloaded')
          await ensureMetaMaskUnlocked(metamaskPage, walletPassword)

          // Handle "Your wallet is ready" page - click "Open wallet"
          const openWalletBtn = metamaskPage.locator('button').filter({ hasText: /open wallet|打开钱包|进入钱包/i }).first()
          if (await openWalletBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
            // Wait up to 30s for the button to be enabled before click.
            for (let i = 0; i < 60; i++) {
              const disabled = await openWalletBtn.isDisabled().catch(() => true)
              if (!disabled) {
                break
              }
              await metamaskPage.waitForTimeout(500)
            }
            await openWalletBtn.click().catch(async () => {
              await openWalletBtn.click({ force: true }).catch(() => {})
            })
            await metamaskPage.waitForTimeout(3_000)
          }

          // Handle any "What's new" / "Pin extension" popover
          const popoverClose = metamaskPage.getByTestId('popover-close').first()
          if (await popoverClose.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await popoverClose.click().catch(() => {})
            await metamaskPage.waitForTimeout(1_000)
          }

          const traceStarted = await context.tracing
            .start({ screenshots: true, snapshots: true, sources: true })
            .then(() => true)
            .catch(() => false)

          const ctx = context as ContextWithMetaMaskState
          ctx[RESOLVED_PROXY] = selectedProxy
          ctx[METAMASK_EXTENSION_ID] = extensionId
          ctx[METAMASK_PAGE] = metamaskPage
          ctx[TRACE_STARTED] = traceStarted
          break
        } catch (error) {
          lastError = error
          if (context) {
            await context.close().catch(() => {})
            context = undefined
          }
          if (attempt < launchRetries) {
            const waitMs = Math.min(8_000, launchBackoffMs * Math.max(1, attempt))
            await sleep(waitMs)
          }
        }
      }

      if (!context) {
        if (lastError instanceof Error) throw lastError
        throw new Error(`[${accountLabel}] launchPersistentContext failed after ${launchRetries} attempts`)
      }

      await use(context)

      const tracePath = path.join(artifactsDir, 'trace.zip')
      const traceStarted = (context as ContextWithMetaMaskState)[TRACE_STARTED] === true
      if (traceStarted) {
        await context.tracing.stop({ path: tracePath }).catch(() => {})
      }

      const failed = testInfo.status !== testInfo.expectedStatus
      if (!failed) {
        await rm(tracePath, { force: true }).catch(() => {})
      }
      await context.close()
    },
    resolvedProxy: async ({ context }, use) => {
      await use((context as ContextWithMetaMaskState)[RESOLVED_PROXY])
    },
    metamaskPage: async ({ context }, use) => {
      const page = (context as ContextWithMetaMaskState)[METAMASK_PAGE]
      if (!page) {
        throw new Error('MetaMask page has not been initialized in context fixture')
      }
      await use(page)
    },
    extensionId: async ({ context }, use) => {
      const cachedId = (context as ContextWithMetaMaskState)[METAMASK_EXTENSION_ID]
      const extensionId = cachedId ?? (await getExtensionIdWithRetry(context, 'MetaMask'))
      await use(extensionId)
    },
    metamask: async (
      { context, extensionId, metamaskPage }: { context: BrowserContext; extensionId: string; metamaskPage: Page },
      use: (metamask: MetaMask) => Promise<void>
    ) => {
      const { walletPassword } = walletSetup
      const metamask = new MetaMaskClass(context, metamaskPage, walletPassword, extensionId) as MetaMask
      await use(metamask)
    },
    page: async ({ page }, use) => {
      await page.goto('/')
      await use(page)
    }
  })
}

function getPositiveInt(value: string | undefined, fallback: number): number {
  const n = Number((value ?? '').trim())
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.floor(n)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function launchPersistentContextForRun(input: {
  currentContext: BrowserContext
  contextPath: string
  cacheDirPath: string
  proxy?: ProxyConfig
  slowMo: number
  locale: string
}): Promise<BrowserContext> {
  await rm(input.contextPath, { recursive: true, force: true }).catch(() => {})
  await cp(input.cacheDirPath, input.contextPath, { recursive: true, force: true })

  const metamaskPath = await prepareExtension()
  const capsolverPath = await prepareCapsolverExtension(input.contextPath, input.proxy)
  const capsolverApiKey = (process.env.CAPSOLVER_API_KEY ?? '').trim()

  const disableExcept = [metamaskPath]
  if (capsolverPath) disableExcept.push(capsolverPath)

  const browserArgs = [
    `--disable-extensions-except=${disableExcept.join(',')}`,
    `--lang=${input.locale}`
  ]
  if (capsolverPath) {
    browserArgs.push(`--load-extension=${capsolverPath}`)
  } else {
    console.warn(`[CapSolver] extension path not found; checked: ${CAPSOLVER_EXTENSION_PATHS.join(', ')}`)
  }
  console.log(`[CapSolver] extension=${capsolverPath ? 'loaded' : 'missing'} apiKey=${capsolverApiKey ? 'set' : 'empty'}`)

  const headlessMode = isTruthyEnv(process.env.HEADLESS)
  if (headlessMode) {
    browserArgs.push('--headless=new')
    if (input.slowMo > 0) console.warn('[WARNING] Slow motion will be ignored in headless mode.')
  }

  const context = await chromium.launchPersistentContext(input.contextPath, {
    headless: headlessMode,
    args: browserArgs,
    slowMo: headlessMode ? 0 : input.slowMo,
    proxy: input.proxy,
    locale: input.locale
  })

  const { cookies, origins } = await input.currentContext.storageState()
  if (cookies?.length) await context.addCookies(cookies)
  if (origins?.length) {
    for (const origin of origins) {
      if (!origin.origin) continue
      const p = await context.newPage()
      await p.goto(origin.origin)
      await p.evaluate((state) => {
        for (const [k, v] of Object.entries(state)) {
          try {
            localStorage.setItem(k, v)
          } catch {}
        }
      }, origin.localStorage.reduce<Record<string, string>>((acc, item) => ({ ...acc, [item.name]: item.value }), {}))
      await p.close()
    }
  }

  return context
}
