export const ALLOWED_SRP_WORD_COUNTS = [12, 15, 18, 21, 24] as const

export function normalizeSecretRecoveryPhrase(seedPhrase: string): string {
  const normalized = (seedPhrase || '').trim().toLowerCase().match(/\w+/gu)?.join(' ')
  return normalized ?? ''
}

export function splitSecretRecoveryPhrase(seedPhrase: string): string[] {
  const normalized = normalizeSecretRecoveryPhrase(seedPhrase)
  return normalized ? normalized.split(' ') : []
}

export function assertValidSrpWordCount(words: string[]): void {
  if (ALLOWED_SRP_WORD_COUNTS.includes(words.length as (typeof ALLOWED_SRP_WORD_COUNTS)[number])) {
    return
  }
  throw new Error(
    `MetaMask 仅支持 ${ALLOWED_SRP_WORD_COUNTS.join(', ')} 词助记词，当前为 ${words.length} 词。`
  )
}
