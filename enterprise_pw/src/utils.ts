import crypto from 'node:crypto'

export function sanitizeLabel(label: string): string {
  const raw = (label ?? '').trim()
  const out = raw
    .split('')
    .map((ch) => (/^[a-z0-9._-]$/i.test(ch) ? ch : '_'))
    .join('')
    .replace(/^[._-]+|[._-]+$/g, '')
  return out || 'account'
}

export function stableId(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12)
}

export function redactSecret(value: string): string {
  const s = (value ?? '').trim()
  if (!s) return ''
  if (s.length <= 8) return '***'
  return `${s.slice(0, 3)}***${s.slice(-3)}`
}
