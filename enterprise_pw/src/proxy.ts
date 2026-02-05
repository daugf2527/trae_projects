import { ProxyConfig } from './types.js'

function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  return true
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return String(value)
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function toServerUrl(input: string): string {
  const s = input.trim()
  if (!s) return ''
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return s
  return `http://${s}`
}

export function parseProxy(input: string): ProxyConfig | undefined {
  const raw = (input ?? '').trim()
  if (!raw) return undefined

  const parsedJson = raw.startsWith('{') || raw.startsWith('[') ? safeJsonParse(raw) : undefined
  if (parsedJson && typeof parsedJson === 'object' && !Array.isArray(parsedJson)) {
    const obj = parsedJson as Record<string, unknown>
    const server = asString(obj.server || obj.proxy || obj.url || '').trim()
    const username = asString(obj.username || obj.user || '').trim()
    const password = asString(obj.password || obj.pass || '').trim()
    const bypass = asString(obj.bypass || obj.noProxy || '').trim()
    if (server) {
      return {
        server: toServerUrl(server),
        username: username || undefined,
        password: password || undefined,
        bypass: bypass || undefined
      }
    }
  }

  const canonical = raw.replace(/\s+/g, '')

  try {
    const url = new URL(toServerUrl(canonical))
    const username = url.username ? decodeURIComponent(url.username) : ''
    const password = url.password ? decodeURIComponent(url.password) : ''
    if (!url.hostname) return undefined
    if (!url.port) return undefined
    url.username = ''
    url.password = ''
    const server = url.toString().replace(/\/$/, '')
    return {
      server,
      username: username || undefined,
      password: password || undefined
    }
  } catch {
    const parts = canonical.split(':')
    if (parts.length === 2) {
      const [host, port] = parts
      if (!host || !port) return undefined
      return { server: `http://${host}:${port}` }
    }
    if (parts.length === 4) {
      const [host, port, username, password] = parts
      if (!host || !port) return undefined
      return {
        server: `http://${host}:${port}`,
        username: username || undefined,
        password: password || undefined
      }
    }
  }

  return undefined
}

export function parseProxyFromAny(value: unknown): ProxyConfig | undefined {
  if (!isTruthy(value)) return undefined
  if (typeof value === 'string') return parseProxy(value)
  if (typeof value === 'object' && value && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    const server = asString(obj.server || obj.proxy || obj.url || '').trim()
    if (!server) return undefined
    return parseProxy(
      JSON.stringify({
        server,
        username: obj.username || obj.user,
        password: obj.password || obj.pass,
        bypass: obj.bypass || obj.noProxy
      })
    )
  }
  return undefined
}

export function extractProxyFromResponse(payload: unknown): ProxyConfig | undefined {
  if (!payload) return undefined
  if (typeof payload === 'string') {
    return parseProxy(payload)
  }
  if (typeof payload === 'object') {
    if (Array.isArray(payload)) {
      for (const item of payload) {
        const found = extractProxyFromResponse(item)
        if (found) return found
      }
      return undefined
    }

    const obj = payload as Record<string, unknown>
    for (const key of ['proxy', 'server', 'url', 'data', 'result', 'payload']) {
      if (key in obj) {
        const found = extractProxyFromResponse(obj[key])
        if (found) return found
      }
    }

    const host = asString(obj.host || obj.ip || obj.ipv4 || obj.addr || '').trim()
    const port = asString(obj.port || '').trim()
    if (host && port) {
      const username = asString(obj.username || obj.user || '').trim()
      const password = asString(obj.password || obj.pass || '').trim()
      return {
        server: `http://${host}:${port}`,
        username: username || undefined,
        password: password || undefined
      }
    }
  }
  return undefined
}

export async function fetchProxyFromPool(): Promise<ProxyConfig | undefined> {
  const url = (process.env.PROXY_POOL_URL ?? '').trim()
  if (!url) return undefined

  const timeoutMs = Number((process.env.PROXY_POOL_TIMEOUT ?? '10').trim()) * 1000
  const headersJson = (process.env.PROXY_POOL_HEADERS_JSON ?? '').trim()
  const headers = headersJson ? (safeJsonParse(headersJson) as Record<string, string> | undefined) : undefined

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs || 10_000))
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: headers && typeof headers === 'object' ? headers : undefined,
      signal: controller.signal
    })
    if (!res.ok) return undefined
    const text = await res.text()
    const trimmed = text.trim()
    const parsed = trimmed.startsWith('{') || trimmed.startsWith('[') ? safeJsonParse(trimmed) : undefined
    return extractProxyFromResponse(parsed ?? trimmed)
  } finally {
    clearTimeout(timer)
  }
}

export async function resolveProxyForAccount(accountProxy?: string): Promise<ProxyConfig | undefined> {
  const direct = parseProxy(accountProxy ?? '')
  if (direct) return direct
  return fetchProxyFromPool()
}
