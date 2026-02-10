import path from 'node:path'
import { chromium, test as base, type BrowserContext, type Page } from '@playwright/test'
import { access, cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import * as synpressCache from '@synthetixio/synpress-cache'
import * as synpressMetaMask from '@synthetixio/synpress-metamask/playwright'
import { resolveProxyForAccount } from '../../src/proxy.js'
import type { ProxyConfig } from '../../src/types.js'
import { sanitizeLabel } from '../../src/utils.js'

const CAPSOLVER_EXTENSION_PATH = path.join(process.cwd(), 'extensions', 'capsolver')
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

async function getCapsolverPath(): Promise<string | null> {
  try {
    await access(CAPSOLVER_EXTENSION_PATH)
    return CAPSOLVER_EXTENSION_PATH
  } catch {
    return null
  }
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
  if (!apiKey && !proxyServer) return tempPath

  const configPath = path.join(tempPath, 'assets', 'config.js')
  try {
    const content = await readFile(configPath, 'utf-8')
    let next = content
    if (apiKey) next = next.replace(/apiKey:\s*['"][^'"]*['"]/, `apiKey: '${apiKey}'`)

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

const { getExtensionId, unlockForFixture, MetaMask: MetaMaskClass } = synpressMetaMask as unknown as {
  getExtensionId: (context: BrowserContext, extensionName: string) => Promise<string>
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

          const extensionId = await getExtensionId(context, 'MetaMask')
          const metamaskPage = (context.pages()[0] as Page | undefined) ?? (await context.newPage())
          await metamaskPage.goto(`chrome-extension://${extensionId}/home.html`)
          await metamaskPage.waitForLoadState('domcontentloaded')

          const unlockInput = metamaskPage.getByTestId('unlock-password').first()
          if (await unlockInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await unlockForFixture(metamaskPage, walletPassword)
          }
<<<<<<< /Users/asd/Documents/trae_projects/enterprise_pw/tests/fixtures/metaMaskFixturesWithProxy.ts
=======
          
          // Handle "Your wallet is ready" page - click "Open wallet"
          const openWalletBtn = metamaskPage.locator('button').filter({ hasText: /open wallet|打开钱包|进入钱包/i }).first()
          if (await openWalletBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
            console.log('[Fixture] Found "Open wallet" button, waiting for it to become enabled...')
            // Wait up to 30s for button to become enabled
            for (let i = 0; i < 60; i++) {
              const disabled = await openWalletBtn.isDisabled().catch(() => true)
              if (!disabled) {
                console.log(`[Fixture] "Open wallet" enabled after ${i * 500}ms`)
                break
              }
              if (i % 10 === 0 && i > 0) console.log(`[Fixture] Still waiting for "Open wallet" to enable... (${i * 500}ms)`)
              await metamaskPage.waitForTimeout(500)
            }
            await openWalletBtn.click().catch(async () => {
              console.log('[Fixture] Normal click failed, trying force click...')
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
          
          console.log('[Fixture] Wallet setup sequence completed')
>>>>>>> /Users/asd/.windsurf/worktrees/trae_projects/trae_projects-0cc80f3c/enterprise_pw/tests/fixtures/metaMaskFixturesWithProxy.ts

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
      const extensionId = cachedId ?? (await getExtensionId(context, 'MetaMask'))
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
<<<<<<< /Users/asd/Documents/trae_projects/enterprise_pw/tests/fixtures/metaMaskFixturesWithProxy.ts
  const extensionsForDisable = [metamaskPath]
  const capsolverPath = await prepareCapsolverExtension(input.contextPath, input.proxy)
  if (capsolverPath) {
    extensionsForDisable.push(capsolverPath)
  }

  const browserArgs = [`--disable-extensions-except=${extensionsForDisable.join(',')}`, `--lang=${input.locale}`]
  if (capsolverPath) {
    browserArgs.push(`--load-extension=${capsolverPath}`)
  }
=======
  const capsolverPath = await prepareCapsolverExtension(input.contextPath, input.proxy)

  // MetaMask is already in persistent context from cache, only CapSolver needs --load-extension
  const disableExcept = [metamaskPath]
  if (capsolverPath) disableExcept.push(capsolverPath)

  console.log('[Launch] Extensions:', disableExcept.map(p => path.basename(p)).join(', '))

  const browserArgs = [
    `--disable-extensions-except=${disableExcept.join(',')}`,
    `--lang=${input.locale}`,
    // Anti-detection flags to help with Cloudflare Turnstile
    '--disable-blink-features=AutomationControlled',
    '--disable-features=AutomationControlled',
    '--disable-infobars',
    '--no-first-run',
    '--no-default-browser-check'
  ]
<<<<<<< /Users/asd/Documents/trae_projects/enterprise_pw/tests/fixtures/metaMaskFixturesWithProxy.ts
<<<<<<< /Users/asd/Documents/trae_projects/enterprise_pw/tests/fixtures/metaMaskFixturesWithProxy.ts
  console.log('[Launch] Browser args:', browserArgs.join(' '))
>>>>>>> /Users/asd/.windsurf/worktrees/trae_projects/trae_projects-0cc80f3c/enterprise_pw/tests/fixtures/metaMaskFixturesWithProxy.ts
=======
>>>>>>> /Users/asd/.windsurf/worktrees/trae_projects/trae_projects-0cc80f3c/enterprise_pw/tests/fixtures/metaMaskFixturesWithProxy.ts
=======
  if (capsolverPath) {
    browserArgs.push(`--load-extension=${capsolverPath}`)
  }
>>>>>>> /Users/asd/.windsurf/worktrees/trae_projects/trae_projects-0cc80f3c/enterprise_pw/tests/fixtures/metaMaskFixturesWithProxy.ts

  if (process.env.HEADLESS) {
    browserArgs.push('--headless=new')
    if (input.slowMo > 0) console.warn('[WARNING] Slow motion will be ignored in headless mode.')
  }

  const context = await chromium.launchPersistentContext(input.contextPath, {
    headless: false,
    args: browserArgs,
    slowMo: process.env.HEADLESS ? 0 : input.slowMo,
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
