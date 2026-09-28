/**
 * SEP-7 "pay" request parsing for the mobile app.
 *
 * Ported from `frontend/wallet/lib/sep7.ts` (same shape and helper names).
 *
 * Scope note: routing an inbound link to a screen is `lib/deepLinks.ts`'s job —
 * it owns the allowlist, host checks and the `web+stellar:` → `/pay` mapping for
 * both cold start and warm resume. This module is the SEP-7 payload layer either
 * side of that: parsing a scanned QR value, and building a pay URI to hand out.
 */

import { Memo } from '@stellar/stellar-sdk'

export type Sep7Parsed = {
  destination?: string
  amount?: string
  assetCode?: string
  assetIssuer?: string
  memo?: string
  memoType?: string
}

const WEB_STELLAR_SCHEME = 'web+stellar:'

function toMaybeString(v: string | null | undefined): string | undefined {
  if (v == null) return undefined
  const t = String(v).trim()
  return t ? t : undefined
}

function fieldsFromParams(params: URLSearchParams): Sep7Parsed {
  return {
    destination: toMaybeString(params.get('destination')),
    amount: toMaybeString(params.get('amount')),
    assetCode: toMaybeString(params.get('asset_code')),
    assetIssuer: toMaybeString(params.get('asset_issuer')),
    memo: toMaybeString(params.get('memo')),
    memoType: toMaybeString(params.get('memo_type')),
  }
}

/** Parse a `web+stellar:pay?...` URI. Returns `null` if it isn't one. */
export function parseSep7Uri(input: string): Sep7Parsed | null {
  const raw = input.trim()
  if (!raw.toLowerCase().startsWith(WEB_STELLAR_SCHEME)) return null

  // web+stellar:pay?... has no "//" authority, so URL can't parse it directly;
  // coerce it into a parseable form the same way the wallet's lib does.
  let url: URL
  try {
    url = new URL(raw.replace(/^web\+stellar:/i, 'web+stellar://'))
  } catch {
    return null
  }

  const operation = (url.hostname || url.pathname.replace(/^\/+/, '')).toLowerCase()
  if (operation !== 'pay') return null

  return fieldsFromParams(url.searchParams)
}

export function looksLikeStellarAddress(s: string): boolean {
  const v = s.trim()
  return (v.startsWith('G') || v.startsWith('C')) && v.length === 56
}

/** Parse a scanned QR value: either a bare Stellar address or a `web+stellar:` URI. */
export function parseQrValue(value: string): Sep7Parsed | { destination: string } | null {
  const v = value.trim()
  if (!v) return null

  if (looksLikeStellarAddress(v)) return { destination: v }

  return parseSep7Uri(v)
}

export function buildSep7PayUri(opts: {
  destination: string
  amount?: string
  assetCode?: string
  assetIssuer?: string
  memo?: string
  memoType?: string
}): string {
  const params = new URLSearchParams()
  params.set('destination', opts.destination)
  if (opts.amount) params.set('amount', opts.amount)
  if (opts.assetCode) params.set('asset_code', opts.assetCode)
  if (opts.assetIssuer) params.set('asset_issuer', opts.assetIssuer)
  if (opts.memo) params.set('memo', opts.memo)
  if (opts.memoType) params.set('memo_type', opts.memoType)

  return `${WEB_STELLAR_SCHEME}pay?${params.toString()}`
}

/**
 * Safely parse and build a Stellar SDK Memo instance from a memo value and optional memo type.
 *
 * Supports standard SEP-7 memo types:
 * - 'text' / 'MEMO_TEXT' (default): UTF-8 text up to 28 bytes.
 * - 'id' / 'MEMO_ID': Unsigned 64-bit integer string.
 * - 'hash' / 'MEMO_HASH': 32-byte hash (64 hex characters or base64 encoded).
 * - 'return' / 'MEMO_RETURN': 32-byte hash (64 hex characters or base64 encoded).
 *
 * Throws an explicit, user-readable Error if the memo value or type is invalid or unsupported.
 */
export function buildStellarMemo(memo: string, memoType?: string | null): Memo | null {
  const trimmed = memo.trim()
  if (!trimmed) return null

  const rawType = (memoType || 'text').trim()
  const lower = rawType.toLowerCase()
  const normalized = lower.startsWith('memo_') ? lower.slice(5) : lower

  switch (normalized) {
    case 'text': {
      const bytes = new TextEncoder().encode(trimmed)
      if (bytes.length > 28) {
        throw new Error(`Text memo exceeds 28 bytes limit (${bytes.length} bytes).`)
      }
      return Memo.text(trimmed)
    }
    case 'id': {
      if (!/^\d+$/.test(trimmed)) {
        throw new Error('ID memo must be an unsigned 64-bit integer.')
      }
      let val: bigint
      try {
        val = BigInt(trimmed)
      } catch {
        throw new Error('ID memo must be an unsigned 64-bit integer.')
      }
      if (val < 0n || val > 18446744073709551615n) {
        throw new Error('ID memo exceeds 64-bit unsigned integer range.')
      }
      return Memo.id(trimmed)
    }
    case 'hash':
    case 'return': {
      let buf: Buffer
      if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        buf = Buffer.from(trimmed, 'hex')
      } else {
        try {
          const normalizedB64 = trimmed.replace(/-/g, '+').replace(/_/g, '/')
          const padded = normalizedB64 + '='.repeat((4 - (normalizedB64.length % 4)) % 4)
          buf = Buffer.from(padded, 'base64')
        } catch {
          throw new Error(`${normalized.toUpperCase()} memo must be a valid 32-byte hash (hex or base64).`)
        }
      }
      if (buf.length !== 32) {
        throw new Error(`${normalized.toUpperCase()} memo must decode to 32 bytes (got ${buf.length}).`)
      }
      const hex = buf.toString('hex')
      return normalized === 'hash' ? Memo.hash(hex) : Memo.return(hex)
    }
    default:
      throw new Error(`Unsupported memo type: "${memoType}".`)
  }
}

/**
 * Validate a memo without throwing, returning a human-readable error or null if valid.
 */
export function validateMemo(memo: string, memoType?: string | null): string | null {
  if (!memo || !memo.trim()) return null
  try {
    buildStellarMemo(memo, memoType)
    return null
  } catch (err: unknown) {
    return err instanceof Error ? err.message : String(err)
  }
}
