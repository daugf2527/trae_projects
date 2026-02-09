import type { BrowserContext, Page } from '@playwright/test'
import { defineWalletSetup } from '@synthetixio/synpress'
import { loadAccounts } from '../../src/accounts.js'
import { runWalletSetupForAccount } from '../../tests/wallet-setup/setupFlow.js'

const ACCOUNT_LABEL = "env"
const WALLET_DISCRIMINATOR = "86d36ae04cb2"
const account = loadAccounts().find((item) => item.label === ACCOUNT_LABEL)

if (!account) {
  throw new Error(`[wallet-setup] 未找到账号: ${ACCOUNT_LABEL}`)
}

export default defineWalletSetup(account.metamaskPassword, async (context: BrowserContext, walletPage: Page) => {
  const walletDiscriminator = WALLET_DISCRIMINATOR
  void walletDiscriminator
  await runWalletSetupForAccount(account, context, walletPage)
})
