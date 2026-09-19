/**
 * `Accept`-header content negotiation for the markdown twin of a page.
 *
 * The contract agents are told to expect (isitagentready.com's
 * markdown-negotiation skill, Cloudflare's "Markdown for Agents") is one
 * URL that answers in HTML for a browser and in markdown for a caller that
 * asked for markdown. That makes the decision entirely a function of the
 * request's `Accept` header, which is what this module is.
 *
 * Kept free of h3 so the rules below are testable as plain strings - the
 * middleware (`server/middleware/01.markdown.ts`) is what reads the header
 * off an event and acts on the answer.
 */

/**
 * What a markdown response says it is. `charset=utf-8` because the catalog
 * carries non-ASCII throughout - route names ("Château"), the physics notes'
 * typographic apostrophes - and `text/*` without a charset is latin-1 to a
 * strict client.
 */
export const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8'

/**
 * The media type an agent asks for. Matched EXACTLY, never through a
 * wildcard: the catch-all range curl and every browser send would otherwise
 * read as a request for markdown, and every caller that never stated a
 * preference would get it - the opposite of "HTML remains the default".
 */
const MARKDOWN_TYPE = 'text/markdown'

/**
 * Everything that counts as "this caller wants the page". The two wildcard
 * ranges are in here rather than ignored so that a header offering markdown
 * at `q=0.5` behind a catch-all - markdown tolerated, but ranked below
 * everything else - still gets HTML.
 */
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml', 'text/*', '*/*'])

interface MediaRange {
  type: string
  q: number
}

/**
 * The header split into media ranges with their quality values (RFC 9110
 * §12.5.1). Only `q` is read; `Accept` extension parameters after it exist
 * but none of them change which representation is wanted.
 *
 * A malformed or out-of-range `q` falls back to 1 rather than rejecting the
 * whole header: an agent that writes `q=high` still plainly asked for the
 * type it wrote it on.
 */
function parseAccept(header: string): MediaRange[] {
  return header
    .split(',')
    .map((part) => {
      const [rawType, ...params] = part.split(';')
      const type = (rawType ?? '').trim().toLowerCase()
      const quality = params
        .map(param => param.trim().toLowerCase())
        .find(param => param.startsWith('q='))
      const q = quality === undefined ? 1 : Number(quality.slice(2))
      return { type, q: Number.isFinite(q) ? Math.min(1, Math.max(0, q)) : 1 }
    })
    .filter(range => range.type.length > 0)
}

/** The best quality value any range `matches` accepts was offered at; 0 when none were. */
function bestQuality(ranges: MediaRange[], matches: (type: string) => boolean): number {
  return Math.max(0, ...ranges.filter(range => matches(range.type)).map(range => range.q))
}

/**
 * Whether this request's `Accept` asks for the markdown representation.
 *
 * True when `text/markdown` is named explicitly, at a quality above zero,
 * and at least as high as anything HTML-shaped in the same header. Ties go
 * to markdown because a caller that listed the type at all named it on
 * purpose - no browser ever sends it - while HTML wins every header that
 * merely tolerates markdown behind a `q`.
 */
export function prefersMarkdown(accept: string | undefined | null): boolean {
  if (!accept) return false
  const ranges = parseAccept(accept)
  const markdown = bestQuality(ranges, type => type === MARKDOWN_TYPE)
  if (markdown <= 0) return false
  return markdown >= bestQuality(ranges, type => HTML_TYPES.has(type))
}

/**
 * The `x-markdown-tokens` figure: roughly how much of a model's context this
 * document costs, so an agent can decide whether to fetch the rest of the
 * site before it does.
 *
 * Four characters per token is the usual English approximation and all this
 * header claims to be - Cloudflare's own is documented as an "estimated
 * number of tokens" too, and no tokenizer belongs in a Worker's hot path for
 * a hint. Rounded up so a non-empty document never reports zero.
 */
export function estimateTokens(markdown: string): number {
  return Math.ceil(markdown.length / 4)
}
