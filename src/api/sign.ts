/**
 * 请求签名的纯函数层（与 UI / 传输层解耦，便于单独测试）。
 *
 * 签名原文（与服务端 app/security.py 逐字节对应）：
 *   METHOD \n PATH \n TS \n NONCE \n SHA256(BODY) \n USER_ID
 *   X-Stland-Sign = HMAC-SHA256(共享密钥, 签名原文) 的十六进制
 *
 * 之所以把这段逻辑单独放在一个不依赖任何第三方库的模块里：
 * 1) 签名属于安全边界，必须可被独立验证，不能藏在适配器内部；
 * 2) 它是纯函数，可在 Node 里用同一份源码跑单元验证，确认与服务端一致；
 * 3) PATH 必须**不含查询串**，与 FastAPI 的 request.url.path 严格对齐。
 */

const encoder = new TextEncoder()

export function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return toHex(digest)
}

export async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message))
  return toHex(sig)
}

/** 16 字节随机数转 32 位十六进制串，用于服务端 nonce 去重 */
export function randomNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 去掉查询串，得到与 request.url.path 一致的路径 */
export function canonicalPath(url: string): string {
  const q = url.indexOf('?')
  return q >= 0 ? url.slice(0, q) : url
}

/**
 * 请求体的规范化文本。
 * 保持与传输层完全一致的序列化方式（对象 → JSON.stringify，字符串原样），
 * 否则服务端重算的 SHA256 会对不上。
 */
export function canonicalBody(data: unknown): string {
  if (data === undefined || data === null) return ''
  if (typeof data === 'string') return data
  return JSON.stringify(data)
}

export interface SignInput {
  method: string
  path: string
  ts: string
  nonce: string
  bodyHash: string
  userId: string
}

export function canonicalString(input: SignInput): string {
  return [input.method.toUpperCase(), input.path, input.ts, input.nonce, input.bodyHash, input.userId].join('\n')
}

export interface SignedHeaders {
  'X-Stland-Ts': string
  'X-Stland-Nonce': string
  'X-Stland-Sign': string
  'X-Stland-User': string
}

/** 生成全套签名头 */
export async function signRequest(opts: {
  secret: string
  method: string
  url: string
  data?: unknown
  userId?: string
  now?: number
}): Promise<SignedHeaders> {
  const ts = String(Math.floor((opts.now ?? Date.now()) / 1000))
  const nonce = randomNonce()
  const bodyHash = await sha256Hex(canonicalBody(opts.data))
  const userId = opts.userId ?? ''
  const sign = await hmacHex(
    opts.secret,
    canonicalString({
      method: opts.method,
      path: canonicalPath(opts.url),
      ts,
      nonce,
      bodyHash,
      userId,
    }),
  )
  return {
    'X-Stland-Ts': ts,
    'X-Stland-Nonce': nonce,
    'X-Stland-Sign': sign,
    'X-Stland-User': userId,
  }
}
