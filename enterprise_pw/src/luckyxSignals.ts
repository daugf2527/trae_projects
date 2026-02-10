export type ChallengeSignals = {
  hasTurnstile: boolean
  hasRecaptcha: boolean
  looksLikeCloudflareInterstitial: boolean
}

const CLOUDFLARE_TEXT_PATTERNS = [
  /checking your browser/i,
  /just a moment/i,
  /please wait while we verify/i,
  /verify you are human/i,
  /human verification/i,
  /人机验证/i,
  /安全验证/i,
  /正在检查您的浏览器/i,
  /cloudflare/i,
  /请稍候/i
]

const MIGRATION_MODAL_PATTERNS = [
  /base chain migration has started/i,
  /migration to base/i,
  /primary network for lucky\s*x/i
]

export function detectChallengeSignals(input: { html?: string; bodyText?: string }): ChallengeSignals {
  const html = (input.html ?? '').toLowerCase()
  const bodyText = (input.bodyText ?? '').toLowerCase()

  const hasTurnstile =
    html.includes('challenges.cloudflare.com/turnstile') ||
    html.includes('cf-turnstile') ||
    bodyText.includes('turnstile')

  const hasRecaptcha =
    html.includes('google.com/recaptcha/api.js') ||
    html.includes('g-recaptcha') ||
    bodyText.includes('recaptcha')

  // Interstitial judgment should come from rendered text, not script URL fragments in raw HTML.
  const looksLikeCloudflareInterstitial = CLOUDFLARE_TEXT_PATTERNS.some((pattern) => pattern.test(bodyText))

  return {
    hasTurnstile,
    hasRecaptcha,
    looksLikeCloudflareInterstitial
  }
}

export function looksLikeMigrationModal(text: string): boolean {
  const raw = text.trim()
  if (!raw) return false
  return MIGRATION_MODAL_PATTERNS.some((pattern) => pattern.test(raw))
}

export function getConnectButtonNamePatterns(): RegExp[] {
  return [
    /connect wallet|link wallet|连接钱包/i,
    /connect|wallet|连接|钱包/i
  ]
}

export function getLoginButtonNamePatterns(): RegExp[] {
  return [
    /login|log in|sign in|登录/i,
    /login|登录/i
  ]
}
