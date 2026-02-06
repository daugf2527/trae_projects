import { expect, type Locator, type Page } from '@playwright/test'
import { ImapFlow } from 'imapflow'

type EmailBindInput = {
  emailAccount: string
  emailPassword: string
  emailImapServer: string
}

export class LuckyXPage {
  constructor(private page: Page) {}

  async connect(metamask: { connectToDapp: (accounts?: string[]) => Promise<void> }): Promise<void> {
    const connectButton = this.page.getByRole('button', { name: /connect|wallet|连接|钱包/i }).first()
    await expect(connectButton).toBeVisible({ timeout: 30_000 })
    await connectButton.click()

    const metamaskOption = this.page.getByText(/metamask/i).first()
    await expect(metamaskOption).toBeVisible({ timeout: 30_000 })
    await metamaskOption.click()

    await metamask.connectToDapp()
  }

  async checkIn(): Promise<void> {
    const candidates = [
      this.page.getByRole('button', { name: /签到|check[- ]?in/i }),
      this.page.getByText(/签到|check[- ]?in/i),
      this.page.getByRole('link', { name: /签到|check[- ]?in/i })
    ]
    for (const locator of candidates) {
      const first = locator.first()
      if (await first.isVisible().catch(() => false)) {
        await first.click({ timeout: 5_000 }).catch(() => {})
        await this.page.waitForTimeout(1_000)
        return
      }
    }
  }

  async bindEmail(input: EmailBindInput): Promise<void> {
    const email = input.emailAccount.trim()
    if (!email) return

    const openProfileCandidates = [
      this.page.getByRole('button', { name: /profile|account|设置|我的/i }),
      this.page.getByRole('link', { name: /profile|account|设置|我的/i }),
      this.page.getByText(/profile|account|设置|我的/i)
    ]
    for (const locator of openProfileCandidates) {
      const first = locator.first()
      if (await first.isVisible().catch(() => false)) {
        await first.click({ timeout: 5_000 }).catch(() => {})
        break
      }
    }

    const emailFieldCandidates: Locator[] = [
      this.page.getByLabel(/email/i),
      this.page.getByPlaceholder(/email/i),
      this.page.locator('input[type="email"]')
    ]

    let emailField: Locator | undefined
    for (const locator of emailFieldCandidates) {
      const first = locator.first()
      if (await first.isVisible().catch(() => false)) {
        emailField = first
        break
      }
    }
    if (!emailField) return

    await emailField.fill(email)

    const sendCodeButton = this.page.getByRole('button', { name: /send|code|验证码|获取验证码/i }).first()
    if (await sendCodeButton.isVisible().catch(() => false)) {
      await sendCodeButton.click().catch(() => {})
    }

    const code = await this.fetchLatestVerificationCodeImap({
      emailAccount: input.emailAccount,
      emailPassword: input.emailPassword,
      emailImapServer: input.emailImapServer
    }).catch(() => '')

    if (!code) return

    const codeFieldCandidates = [
      this.page.getByLabel(/code|验证码/i),
      this.page.getByPlaceholder(/code|验证码/i),
      this.page.locator('input[inputmode="numeric"]')
    ]
    for (const locator of codeFieldCandidates) {
      const first = locator.first()
      if (await first.isVisible().catch(() => false)) {
        await first.fill(code)
        break
      }
    }

    const confirmButton = this.page.getByRole('button', { name: /confirm|bind|verify|确认|绑定|验证/i }).first()
    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click().catch(() => {})
    }
  }

  async bindInvite(inviteCode: string): Promise<void> {
    const code = inviteCode.trim()
    if (!code) return

    const input = this.page.getByPlaceholder(/invite code|邀请码/i).first()
    if (await input.isVisible().catch(() => false)) {
      await input.fill(code)
      await this.page.getByRole('button', { name: /confirm|submit|绑定|确认/i }).first().click().catch(() => {})
    }
  }

  private async fetchLatestVerificationCodeImap(input: EmailBindInput): Promise<string> {
    const user = input.emailAccount.trim()
    const pass = input.emailPassword.trim()
    const serverRaw = input.emailImapServer.trim()
    if (!user || !pass || !serverRaw) return ''

    const { host, port } = this.parseImapServer(serverRaw)
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

  private parseImapServer(server: string): { host: string; port: number } {
    const s = server.trim().replace(/^imaps?:\/\//, '')
    const idx = s.lastIndexOf(':')
    if (idx > 0 && idx < s.length - 1) {
      const host = s.slice(0, idx)
      const port = Number(s.slice(idx + 1))
      if (host && Number.isFinite(port) && port > 0) return { host, port }
    }
    return { host: s, port: 993 }
  }
}
