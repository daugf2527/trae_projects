import type { Page } from '@playwright/test'
import * as synpressMetaMask from '@synthetixio/synpress-metamask/playwright'
import type { AccountConfig } from '../../src/types.js'
import {
  ALLOWED_SRP_WORD_COUNTS,
  assertValidSrpWordCount,
  normalizeSecretRecoveryPhrase,
  splitSecretRecoveryPhrase
} from '../../src/srp.js'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

const { MetaMask: MetaMaskClass } = synpressMetaMask as unknown as {
  MetaMask: new (
    context: unknown,
    walletPage: unknown,
    password: string,
    extensionId?: string
  ) => {
    importWalletFromPrivateKey: (privateKey: string) => Promise<void>
  }
}

export async function runWalletSetupForAccount(
  account: AccountConfig,
  context: unknown,
  walletPage: unknown
): Promise<void> {
  const metamask = new MetaMaskClass(context, walletPage, account.metamaskPassword)
  const page = walletPage as Page
  const seedPhrase = (account.metamaskSeedPhrase ?? '').trim()
  const privateKey = (account.metamaskPrivateKey ?? '').trim()

  if (seedPhrase) {
    await importWalletFromSeedPhrase(page, account.metamaskPassword, seedPhrase)
    return
  }

  if (privateKey) {
    const onboardingVisible = await isMetaMaskOnboardingVisible(page)
    if (onboardingVisible) {
      throw new Error(
        `[${account.label}] 当前仍在 MetaMask 首次初始化页面，私钥导入需要先完成钱包初始化；请配置 metamask_seed_phrase 完成首登后再使用私钥导入。`
      )
    }
    await metamask.importWalletFromPrivateKey(privateKey)
    return
  }

  throw new Error(`[${account.label}] 缺少 metamask_seed_phrase 或 metamask_private_key`)
}

async function importWalletFromSeedPhrase(page: Page, password: string, seedPhrase: string): Promise<void> {
  await ensureEnglishLocaleIfAvailable(page)

  await clickAny(page, [
    () => page.getByTestId('onboarding-import-wallet').first(),
    () => page.getByRole('button', { name: /i already have a wallet|import wallet|我已有一个钱包|导入钱包/i }).first()
  ])

  await clickAny(page, [
    () => page.getByTestId('onboarding-import-with-srp-button').first(),
    () => page.getByRole('button', { name: /secret recovery phrase|srp|助记词/i }).first()
  ])

  const normalizedSeedPhrase = normalizeSecretRecoveryPhrase(seedPhrase)
  const words = splitSecretRecoveryPhrase(normalizedSeedPhrase)
  assertValidSrpWordCount(words)
  const inputMode = await waitForSeedInputMode(page, 30_000)
  if (inputMode === 'words') {
    const filledByWords = await fillSeedWords(page, words)
    if (!filledByWords) {
      const filledByTextarea = await tryFillSeedTextarea(page, words, normalizedSeedPhrase)
      if (!filledByTextarea) {
        await debugSnapshot(page, 'seed-fill-failed')
        throw new Error('助记词填充失败：word-input 与 textarea 两种模式都不可用')
      }
    }
  } else {
    const filledByTextarea = await tryFillSeedTextarea(page, words, normalizedSeedPhrase)
    if (!filledByTextarea) {
      const filledByWords = await fillSeedWords(page, words)
      if (!filledByWords) {
        await debugSnapshot(page, 'seed-fill-failed')
        throw new Error('助记词填充失败：textarea 与 word-input 两种模式都不可用')
      }
    }
  }

  const confirmImport = page.getByTestId('import-srp-confirm').first()
  await debugSnapshot(page, 'before-import-confirm')
  await waitUntilEnabled(confirmImport, 20_000, page)
  await confirmImport.click()

  const pwdInput = page.getByTestId('create-password-new-input').first()
  const confirmInput = page.getByTestId('create-password-confirm-input').first()
  await pwdInput.waitFor({ state: 'visible', timeout: 20_000 })
  await pwdInput.fill(password)
  await confirmInput.fill(password)

  const terms = page.getByTestId('create-password-terms').first()
  if (await terms.isVisible().catch(() => false)) {
    await terms.check({ force: true }).catch(async () => {
      await terms.click({ force: true }).catch(() => {})
    })
  }

  const submitPassword = page.getByTestId('create-password-submit').first()
  await waitUntilEnabled(submitPassword, 20_000, page)
  await submitPassword.click()

  const optOutToggle = page.locator('#metametrics-opt-in').first()
  if (await optOutToggle.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await optOutToggle.click().catch(() => {})
  }

  await clickAny(page, [
    () => page.getByTestId('metametrics-i-agree').first(),
    () => page.getByRole('button', { name: /i agree|no thanks|稍后|不同意/i }).first(),
    () => page.getByTestId('onboarding-complete-done').first()
  ])

  const done = page.getByTestId('onboarding-complete-done').first()
  if (await done.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await done.click().catch(() => {})
  }

  // Handle "Your wallet is ready" → "Open wallet" / "Got it" page (newer MetaMask versions)
  const openWalletBtn = page.locator('button').filter({ hasText: /open wallet|got it|done|完成|打开钱包|进入钱包/i }).first()
  if (await openWalletBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
    // Wait for button to become enabled (may be disabled initially)
    for (let i = 0; i < 20; i++) {
      if (await openWalletBtn.isEnabled().catch(() => false)) break
      await page.waitForTimeout(500)
    }
    await openWalletBtn.click().catch(() => {})
    await page.waitForTimeout(2_000)
  }

  // Handle any "What's new" or "Pin extension" popover after opening wallet
  await clickAny(page, [
    () => page.getByTestId('popover-close').first(),
    () => page.locator('button').filter({ hasText: /got it|close|关闭|知道了/i }).first()
  ])
}

async function clickAny(page: Page, locators: Array<() => ReturnType<Page['locator']>>): Promise<boolean> {
  for (const build of locators) {
    const target = build()
    if (await target.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await target.click({ timeout: 5_000 }).catch(() => {})
      return true
    }
  }
  return false
}

async function isMetaMaskOnboardingVisible(page: Page): Promise<boolean> {
  const createBtn = page.getByTestId('onboarding-create-wallet').first()
  const importBtn = page.getByTestId('onboarding-import-wallet').first()
  const createVisible = await createBtn.isVisible().catch(() => false)
  if (createVisible) return true
  const importVisible = await importBtn.isVisible().catch(() => false)
  return importVisible
}

async function waitUntilEnabled(
  locator: ReturnType<Page['locator']>,
  timeoutMs: number,
  page: Page
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const enabled = await locator.isEnabled().catch(() => false)
    if (enabled) return
    await page.waitForTimeout(250)
  }
  await debugSnapshot(page, 'wait-enabled-timeout')
  const errorMsg =
    (await page.locator('.mm-banner-alert.import-srp__srp-error div').first().innerText().catch(() => '')) || ''
  throw new Error(`等待元素可点击超时: ${await locator.textContent().catch(() => '')} ${errorMsg}`.trim())
}

async function waitForSeedInputMode(page: Page, timeoutMs: number): Promise<'words' | 'textarea'> {
  const start = Date.now()
  const importWithSrpBtn = page.getByTestId('onboarding-import-with-srp-button').first()
  while (Date.now() - start < timeoutMs) {
    const firstWordInput = page.getByTestId('import-srp__srp-word-0').first()
    if (await firstWordInput.isVisible().catch(() => false)) return 'words'

    const srpTextarea = page.getByTestId('srp-input-import__srp-note').first()
    if (await srpTextarea.isVisible().catch(() => false)) return 'textarea'

    if (await importWithSrpBtn.isVisible().catch(() => false)) {
      await importWithSrpBtn.click({ timeout: 2_000 }).catch(() => {})
    }

    await page.waitForTimeout(300)
  }

  throw new Error('未找到助记词输入区域（word inputs / srp textarea）')
}

async function alignWordCountDropdown(page: Page, targetWords: number): Promise<void> {
  if (!ALLOWED_SRP_WORD_COUNTS.includes(targetWords as (typeof ALLOWED_SRP_WORD_COUNTS)[number])) {
    throw new Error(
      `MetaMask 仅支持 ${ALLOWED_SRP_WORD_COUNTS.join(', ')} 词助记词，当前为 ${targetWords} 词。`
    )
  }

  const dropdown = page.locator('.import-srp__number-of-words-dropdown .dropdown__select').first()
  const visible = await dropdown.isVisible({ timeout: 2_000 }).catch(() => false)
  if (!visible) return

  const current = (await dropdown.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
  if (current.includes(String(targetWords))) return

  await dropdown.click({ timeout: 2_000 }).catch(() => {})
  const optionRegex = new RegExp(`\\b${targetWords}\\b`)
  const option = page.locator('[role=\"option\"], .dropdown__menu-item').filter({ hasText: optionRegex }).first()
  const optionVisible = await option.isVisible({ timeout: 3_000 }).catch(() => false)
  if (!optionVisible) {
    throw new Error(
      `MetaMask 词数下拉未找到 ${targetWords} 词选项。可用词数：${ALLOWED_SRP_WORD_COUNTS.join(', ')}`
    )
  }
  await option.click({ timeout: 2_000 }).catch(() => {})
}

async function fillSeedWords(page: Page, words: string[]): Promise<boolean> {
  await alignWordCountDropdown(page, words.length)
  const hasAnyInput = await page.locator('[data-testid^="import-srp__srp-word-"]').first().isVisible({ timeout: 5_000 }).catch(() => false)
  if (!hasAnyInput) return false

  await clickAny(page, [() => page.getByText(/clear all|全部清除/i).first()])

  const firstInput = page.locator('[data-testid^="import-srp__srp-word-"]').first()
  await firstInput.click({ timeout: 2_000 }).catch(() => {})
  await page.keyboard.type(words.join(' '), { delay: 25 }).catch(() => {})
  await page.waitForTimeout(300)

  const confirmImport = page.getByTestId('import-srp-confirm').first()
  const enabledByBulkType = await confirmImport.isEnabled().catch(() => false)
  if (enabledByBulkType) {
    return true
  }

  await clickAny(page, [() => page.getByText(/clear all|全部清除/i).first()])
  for (let i = 0; i < words.length; i += 1) {
    const input = await getCurrentWordInput(page)
    if (!input) return false
    await input.click({ timeout: 2_000 }).catch(() => {})
    await input.fill(words[i] ?? '').catch(() => {})
    if (i < words.length - 1) {
      await page.keyboard.press('Space').catch(() => {})
    }
    await page.waitForTimeout(100)
  }
  return true
}

async function tryFillSeedTextarea(page: Page, words: string[], seedPhrase: string): Promise<boolean> {
  const srpInput = page.getByTestId('srp-input-import__srp-note').first()
  const visible = await srpInput.isVisible({ timeout: 3_000 }).catch(() => false)
  if (!visible) return false

  await srpInput.click({ timeout: 2_000 }).catch(() => {})
  await srpInput.fill('', { timeout: 2_000 }).catch(() => {})
  for (let i = 0; i < words.length; i += 1) {
    if (i > 0) await srpInput.press(' ').catch(() => {})
    const typed = await srpInput.type(words[i] ?? '', { delay: 20, timeout: 2_000 }).then(() => true).catch(() => false)
    if (!typed) return false
  }

  // 触发末尾输入与 blur，兼容部分版本仅在按键事件后才激活“继续”。
  await srpInput.press(' ').catch(() => {})
  await srpInput.press('Backspace').catch(() => {})
  await page.locator('h1, h2').first().click({ timeout: 2_000 }).catch(() => {})

  const confirmImport = page.getByTestId('import-srp-confirm').first()
  const enabledAfterTyping = await confirmImport.isEnabled().catch(() => false)
  if (enabledAfterTyping) return true

  const copied = await page
    .evaluate(async (phrase) => {
      try {
        await navigator.clipboard.writeText(phrase)
        return true
      } catch {
        return false
      }
    }, seedPhrase)
    .catch(() => false)
  if (copied) {
    await clickAny(page, [() => page.getByText(/paste|粘贴/i).first()])
  }
  return true
}

async function getCurrentWordInput(page: Page): Promise<ReturnType<Page['locator']> | null> {
  const fields = page.locator('[data-testid^="import-srp__srp-word-"]')
  const count = await fields.count().catch(() => 0)
  if (count < 1) return null

  for (let i = count - 1; i >= 0; i -= 1) {
    const field = fields.nth(i)
    const visible = await field.isVisible().catch(() => false)
    if (!visible) continue
    const enabled = await field.isEnabled().catch(() => false)
    if (!enabled) continue
    return field
  }
  return fields.nth(count - 1)
}

async function ensureEnglishLocaleIfAvailable(page: Page): Promise<void> {
  const languageSelect = page.getByRole('combobox').first()
  const visible = await languageSelect.isVisible({ timeout: 2_000 }).catch(() => false)
  if (!visible) return

  const hasEnglish = await languageSelect
    .evaluate((el) => {
      if (!(el instanceof HTMLSelectElement)) return false
      return Array.from(el.options).some((o) => /english/i.test(o.text))
    })
    .catch(() => false)
  if (!hasEnglish) return

  await languageSelect.selectOption({ label: 'English' }).catch(() => {})
}

async function debugSnapshot(page: Page, label: string): Promise<void> {
  const dir = path.join(process.cwd(), 'artifacts', 'wallet-setup-debug')
  await mkdir(dir, { recursive: true }).catch(() => {})
  const ts = new Date().toISOString().replace(/[:.]/g, '-')

  await page.screenshot({ path: path.join(dir, `${ts}-${label}.png`), fullPage: true }).catch(() => {})
  const text = await page.locator('body').innerText().catch(() => '')
  await writeFile(path.join(dir, `${ts}-${label}.txt`), text, 'utf-8').catch(() => {})
}
