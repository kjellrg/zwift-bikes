/**
 * Turns a filled-in report form into the three things the UI can hand off:
 * a prefilled GitHub issue URL, a `mailto:` URL, and the plain-text version
 * behind "Copy report".
 *
 * Nothing here submits anything - the site has no report endpoint and no
 * database, which is what keeps the promises in `AboutContent.vue` true. The
 * whole feature is "compose a good report, then hand it to something that
 * already accepts reports".
 *
 * Pure and framework-free on purpose: every fiddly rule (field ids, URL
 * length limits, truncation order) is in one place where it can be reasoned
 * about, rather than smeared across a Vue component.
 */

const REPO = 'kjellrg/zwift-bikes'

/**
 * Assembled at call time rather than written out as a literal `mailto:` in a
 * template, so neither address ends up in served HTML or in a JS bundle where
 * an address harvester's `user@host.tld` regex would match it. Changing an
 * alias is a one-line change here.
 *
 * `.join('@')` rather than a template literal on purpose: a template literal
 * over two `const` strings gets constant-folded by the minifier, which puts
 * `bugs@` back next to the domain in the built chunk. A runtime `Array.join`
 * is opaque to that pass, so the built code reads `["bugs",e].join("@")` and
 * the pairing only exists once the browser evaluates it.
 */
const MAIL_DOMAIN = 'zwiftbikes.com'
const MAIL_USER = 'bugs'
export const reportEmailAddress = () => [MAIL_USER, MAIL_DOMAIN].join('@')

/**
 * The general "not a bug, just getting in touch" alias, shown on the About
 * page. Same treatment for the same reason, and doubly so here: `/about` is
 * prerendered (see `nitro.prerender.routes`), so a literal address in that
 * template would be baked into a static file that harvesters can read without
 * running any JS at all - which is why the About page keeps it behind
 * `<ClientOnly>` as well.
 */
const CONTACT_USER = 'contact'
export const contactEmailAddress = () => [CONTACT_USER, MAIL_DOMAIN].join('@')

export type ReportKind = 'bug' | 'data'

/**
 * GitHub issue-form field ids, per template. These are a contract with
 * `.github/ISSUE_TEMPLATE/*.yml`: the `id:` of a field is its URL prefill
 * key, so renaming one there without renaming it here silently drops that
 * field's content from every prefilled report - the form still opens, just
 * blank, with no error anywhere.
 *
 * Two GitHub behaviours shape what can live in these forms:
 * - `dropdown` prefills by matching the option's *label*, not its index.
 * - `checkboxes` don't reliably prefill at all, so no auto-captured value
 *   may be carried in one. (bug.yml's confirmation checkbox is deliberately
 *   the rider's own click, not something this file can pre-tick.)
 */
const TEMPLATES: Record<ReportKind, { file: string, fields: Record<string, string> }> = {
  bug: {
    file: 'bug.yml',
    fields: {
      whatHappened: 'what-happened',
      expected: 'expected',
      context: 'app-context'
    }
  },
  data: {
    file: 'data-correction.yml',
    fields: {
      item: 'item',
      shown: 'shown',
      expected: 'expected',
      source: 'source',
      context: 'app-context'
    }
  }
}

export interface ReportDraft {
  kind: ReportKind
  /** Issue title. Falls back to a generic one so a report is never titleless. */
  title: string
  /** Bug: what the rider did and what happened. */
  whatHappened?: string
  /** Both kinds: what they expected instead. */
  expected?: string
  /** Data correction: which frame / wheelset / route. */
  item?: string
  /** Data correction: what the site currently shows. */
  shown?: string
  /** Data correction: link to the measurement. */
  source?: string
  /** Pre-rendered auto-captured context block (see `useReportContext`). */
  context?: string
}

export interface BuiltReport {
  title: string
  /** The full report as text - what "Copy report" puts on the clipboard. */
  plainText: string
  githubUrl: string
  mailtoUrl: string
  /** True when either URL had to shed content to fit - the UI says so. */
  truncated: boolean
}

/**
 * Length budgets for the two hand-off URLs.
 *
 * GitHub itself accepts long query strings, but browsers and intermediaries
 * start rejecting somewhere past ~8 KB, and the failure mode is a 414 on a
 * page the rider was told would work. 6000 leaves headroom.
 *
 * `mailto:` is much tighter and fails far more quietly: several desktop
 * clients silently truncate the body somewhere past ~2000 characters, so a
 * rider would send a report whose context block just stops mid-line without
 * either of us knowing. 1800 keeps the whole thing under that.
 */
const GITHUB_URL_MAX_CHARS = 6000
const MAILTO_MAX_CHARS = 1800

/** Applied to free-text fields only after dropping the context block wasn't enough. */
const MAX_FIELD_CHARS = 1200

const CONTEXT_OMITTED
  = '(App context omitted - it made this link too long for the browser to '
    + 'open. Use "Copy report" on the site and paste the full version here.)'

const BODY_OMITTED
  = '(This report was too long to carry in a link. Use "Copy report" on the '
    + 'site and paste it here.)'

const DEFAULT_TITLES: Record<ReportKind, string> = {
  bug: 'Bug report',
  data: 'Wrong data'
}

function clip(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max).trimEnd()}...`
}

/**
 * The draft's free-text fields keyed by the *draft* key (not the GitHub field
 * id), with blanks dropped, so both renderers below iterate the same content.
 */
function fieldValues(draft: ReportDraft, context: string | undefined) {
  const values: Record<string, string> = {}
  const add = (key: string, value: string | undefined) => {
    const trimmed = value?.trim()
    if (trimmed) values[key] = trimmed
  }

  if (draft.kind === 'bug') {
    add('whatHappened', draft.whatHappened)
    add('expected', draft.expected)
  } else {
    add('item', draft.item)
    add('shown', draft.shown)
    add('expected', draft.expected)
    add('source', draft.source)
  }
  add('context', context)

  return values
}

const FIELD_HEADINGS: Record<string, string> = {
  whatHappened: 'What happened',
  expected: 'Expected instead',
  item: 'What is wrong',
  shown: 'What the site shows',
  source: 'Source',
  context: 'App context'
}

function renderPlainText(title: string, values: Record<string, string>) {
  const sections = Object.entries(values)
    .map(([key, value]) => `## ${FIELD_HEADINGS[key] ?? key}\n\n${value}`)
    .join('\n\n')
  return `# ${title}\n\n${sections}\n`
}

function githubUrlFor(kind: ReportKind, title: string, values: Record<string, string>) {
  const template = TEMPLATES[kind]
  const params = new URLSearchParams({ template: template.file, title })
  for (const [key, value] of Object.entries(values)) {
    const fieldId = template.fields[key]
    // A draft key with no matching field id can only mean this file and the
    // YAML have drifted; dropping it beats emitting a junk query param.
    if (fieldId) params.set(fieldId, value)
  }
  return `https://github.com/${REPO}/issues/new?${params.toString()}`
}

function mailtoUrlFor(title: string, body: string) {
  const params = new URLSearchParams({ subject: title, body })
  return `mailto:${reportEmailAddress()}?${params.toString()}`
}

/**
 * Tries each rendering in order and returns the first that fits: full, then
 * without the auto-captured context, then with the free-text fields clipped,
 * then a near-empty shell pointing at "Copy report".
 *
 * Written as an ordered list of candidates rather than a shrink-until-it-fits
 * loop because the order in which content gets dropped is a judgement call -
 * the rider's own words are worth more than the context block this code
 * gathered on its own, so context goes first no matter how long the prose is.
 */
function fitToLimit(
  candidates: Array<() => string>,
  limit: number
): { url: string, truncated: boolean } {
  let url = ''
  for (const [index, candidate] of candidates.entries()) {
    url = candidate()
    if (url.length <= limit) return { url, truncated: index > 0 }
  }
  // Even the last (shortest) candidate is over: hand it back anyway rather
  // than returning nothing, since a too-long link the rider can still see
  // beats a dead button.
  return { url, truncated: true }
}

export function buildReport(draft: ReportDraft): BuiltReport {
  const title = draft.title.trim() || DEFAULT_TITLES[draft.kind]

  const full = fieldValues(draft, draft.context)
  const withoutContext = fieldValues(draft, CONTEXT_OMITTED)
  const clipped = Object.fromEntries(
    Object.entries(withoutContext).map(([key, value]) => [
      key,
      key === 'context' ? value : clip(value, MAX_FIELD_CHARS)
    ])
  )

  const github = fitToLimit([
    () => githubUrlFor(draft.kind, title, full),
    () => githubUrlFor(draft.kind, title, withoutContext),
    () => githubUrlFor(draft.kind, title, clipped),
    () => githubUrlFor(draft.kind, title, { context: BODY_OMITTED })
  ], GITHUB_URL_MAX_CHARS)

  const mail = fitToLimit([
    () => mailtoUrlFor(title, renderPlainText(title, full)),
    () => mailtoUrlFor(title, renderPlainText(title, withoutContext)),
    () => mailtoUrlFor(title, renderPlainText(title, clipped)),
    () => mailtoUrlFor(title, BODY_OMITTED)
  ], MAILTO_MAX_CHARS)

  return {
    title,
    // Always the complete version - the clipboard has no length limit, which
    // is exactly why it's the fallback the truncation notices point at.
    plainText: renderPlainText(title, full),
    githubUrl: github.url,
    mailtoUrl: mail.url,
    truncated: github.truncated || mail.truncated
  }
}
