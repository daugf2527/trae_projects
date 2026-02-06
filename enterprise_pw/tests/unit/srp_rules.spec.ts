import { expect, test } from '@playwright/test'
import {
  ALLOWED_SRP_WORD_COUNTS,
  assertValidSrpWordCount,
  normalizeSecretRecoveryPhrase,
  splitSecretRecoveryPhrase
} from '../../src/srp.js'

test('normalizeSecretRecoveryPhrase 按 MetaMask 规则清洗输入', () => {
  const normalized = normalizeSecretRecoveryPhrase('  ABANDON,  abandon\nABOUT  ')
  expect(normalized).toBe('abandon abandon about')
})

test('assertValidSrpWordCount 拒绝 14 词', () => {
  const words = new Array(14).fill('abandon')
  expect(() => assertValidSrpWordCount(words)).toThrow(/12, 15, 18, 21, 24/)
})

test('assertValidSrpWordCount 接受官方支持词数', () => {
  for (const count of ALLOWED_SRP_WORD_COUNTS) {
    const words = new Array(count).fill('abandon')
    expect(() => assertValidSrpWordCount(words)).not.toThrow()
  }
})

test('splitSecretRecoveryPhrase 返回规范化后的词数组', () => {
  const words = splitSecretRecoveryPhrase(' alpha\tbeta\n\nGamma ')
  expect(words).toEqual(['alpha', 'beta', 'gamma'])
})
