import { expect, test } from '@playwright/test'
import {
  detectChallengeSignals,
  getConnectButtonNamePatterns,
  getLoginButtonNamePatterns,
  looksLikeMigrationModal
} from '../../src/luckyxSignals.js'

test('detectChallengeSignals 能识别 Turnstile + reCAPTCHA 双脚本', () => {
  const html = [
    '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>',
    '<script src="https://www.google.com/recaptcha/api.js" async defer></script>'
  ].join('\n')

  const signals = detectChallengeSignals({
    html,
    bodyText: 'welcome to luckyx'
  })

  expect(signals.hasTurnstile).toBe(true)
  expect(signals.hasRecaptcha).toBe(true)
  expect(signals.looksLikeCloudflareInterstitial).toBe(false)
})

test('detectChallengeSignals 能识别 Cloudflare 人机校验文案', () => {
  const signals = detectChallengeSignals({
    html: '<html><body>Just a moment...</body></html>',
    bodyText: 'Checking your browser before accessing app.luckyx.world'
  })

  expect(signals.looksLikeCloudflareInterstitial).toBe(true)
})

test('looksLikeMigrationModal 能识别 LuckyX Base 迁移弹窗', () => {
  const text = 'Base Chain Migration Has Started\nBase is now the primary network for LUCKY X'
  expect(looksLikeMigrationModal(text)).toBe(true)
})

test('getConnectButtonNamePatterns 优先覆盖 connect wallet 文案', () => {
  const patterns = getConnectButtonNamePatterns()

  expect(patterns.some((re) => re.test('Connect Wallet'))).toBe(true)
  expect(patterns.some((re) => re.test('连接钱包'))).toBe(true)
})

test('getLoginButtonNamePatterns 覆盖 login 文案', () => {
  const patterns = getLoginButtonNamePatterns()

  expect(patterns.some((re) => re.test('Login'))).toBe(true)
  expect(patterns.some((re) => re.test('登录'))).toBe(true)
})
