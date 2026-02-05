import path from 'node:path'
import { chromium, test as base, type BrowserContext, type Page } from '@playwright/test'
import { access, cp, mkdir, readdir, rm, readFile, writeFile } from 'node:fs/promises'
import * as synpressCache from '@synthetixio/synpress-cache'
import * as synpressMetaMask from '@synthetixio/synpress-metamask/playwright'
import { resolveProxyForAccount } from '../../src/proxy.js'
import type { ProxyConfig } from '../../src/types.js'
import { sanitizeLabel } from '../../src/utils.js'

const CAPSOLVER_EXTENSION_PATH = path.join(process.cwd(), 'extensions', 'capsolver')

async function getCapsolverPath(): Promise<string | null> {
  try {
    await access(CAPSOLVER_EXTENSION_PATH)
    return CAPSOLVER_EXTENSION_PATH
  } catch {
    return null
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
}

export function metaMaskFixturesWithProxy(
  walletSetup: ReturnType<typeof defineWalletSetup>,
  accountLabel: string,
  accountProxy?: string,
  slowMo = 0
) {
  return base.extend<MetaMaskFixtures>({
    artifactsDir: async ({}, use, testInfo) => {
      const artifactsRoot = process.env.ARTIFACTS_DIR?.trim() || path.join(process.cwd(), 'artifacts')
      const dir = path.join(artifactsRoot, sanitizeLabel(accountLabel), testInfo.testId)
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
      const { walletPassword, hash } = walletSetup
      const proxy = (await resolveProxyForAccount(accountProxy)) as ProxyConfig | undefined

      const cacheRootPath = path.join(process.cwd(), CACHE_DIR_NAME)
      const cacheDirPath = path.join(cacheRootPath, hash)
      try {
        await access(cacheDirPath)
      } catch {
        await mkdir(cacheRootPath, { recursive: true })
      }

      const cacheEntries = await safeReadDir(cacheDirPath)
      if (!cacheEntries.length) {
        await createCacheForWalletSetup(cacheDirPath, walletSetup, proxy)
      }

      await cp(cacheDirPath, _contextPath, { recursive: true, force: true })

      const metamaskPath = await prepareExtension()
      const extensions = [metamaskPath]
      const capsolverPath = await prepareCapsolverExtension(_contextPath, proxy)
      if (capsolverPath) extensions.push(capsolverPath)

      const browserArgs = [
        `--disable-extensions-except=${extensions.join(',')}`,
        `--load-extension=${extensions.join(',')}`
      ]

      if (process.env.HEADLESS) {
        browserArgs.push('--headless=new')
        if (slowMo > 0) console.warn('[WARNING] Slow motion will be ignored in headless mode.')
      }

      const context = await chromium.launchPersistentContext(_contextPath, {
        headless: false,
        args: browserArgs,
        slowMo: process.env.HEADLESS ? 0 : slowMo,
        proxy
      })

      const { cookies, origins } = await currentContext.storageState()
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

      await use(context)
      const tracePath = path.join(artifactsDir, 'trace.zip')
      await context.tracing.stop({ path: tracePath }).catch(() => {})
      const failed = testInfo.status !== testInfo.expectedStatus
      if (!failed) {
        await rm(tracePath, { force: true }).catch(() => {})
      }
      await context.close()
    },
    metamaskPage: async ({ context }, use) => {
      const { walletPassword } = walletSetup
      const extensionId = await getExtensionId(context, 'MetaMask')
      const page = await context.newPage()
      await page.goto(`chrome-extension://${extensionId}/home.html`)
      await page.waitForLoadState('domcontentloaded')
      await unlockForFixture(page, walletPassword)
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true }).catch(() => {})
      await use(page)
    },
    extensionId: async ({ context }, use) => {
      const extensionId = await getExtensionId(context, 'MetaMask')
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

async function safeReadDir(dirPath: string): Promise<string[]> {
  try {
    return await readdir(dirPath)
  } catch {
    return []
  }
}

async function createCacheForWalletSetup(
  cacheDirPath: string,
  walletSetup: ReturnType<typeof defineWalletSetup>,
  proxy?: ProxyConfig
): Promise<void> {
  const tmpContextPath = await createTempContextDir('chromium', `cache_${walletSetup.hash}`)
  const metamaskPath = await prepareExtension()
  const extensions = [metamaskPath]
  const capsolverPath = await prepareCapsolverExtension(tmpContextPath, proxy)
  if (capsolverPath) extensions.push(capsolverPath)

  const browserArgs = [
    `--disable-extensions-except=${extensions.join(',')}`,
    `--load-extension=${extensions.join(',')}`
  ]

  if (process.env.HEADLESS) {
    browserArgs.push('--headless=new')
  }

  const context = await chromium.launchPersistentContext(tmpContextPath, {
    headless: false,
    args: browserArgs,
    slowMo: 0,
    proxy
  })

  try {
    const extensionId = await getExtensionId(context, 'MetaMask')
    const walletPage = (context.pages()[0] as Page | undefined) ?? (await context.newPage())
    await walletPage.goto(`chrome-extension://${extensionId}/home.html`)
    await walletPage.waitForLoadState('domcontentloaded')
    await walletSetup.fn(context, walletPage)
  } finally {
    await context.close()
  }

  await mkdir(cacheDirPath, { recursive: true })
  await cp(tmpContextPath, cacheDirPath, { recursive: true, force: true })
  await rm(tmpContextPath, { recursive: true, force: true })
}
