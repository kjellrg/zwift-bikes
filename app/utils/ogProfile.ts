import { outlineRuns, silhouetteOutline, type Silhouette, type SurfaceFamily } from '#shared/utils/silhouette'

/**
 * What the share cards draw, and what they draw it with. The cards render at
 * build time in Takumi, which takes no CSS variables and no Tailwind theme,
 * so the Palette's dark-mode values are restated here as the one place the
 * cards read them - the same hex values `main.css` resolves the tokens to.
 * A Palette change is a change here too (see **Palette** in `CONTEXT.md`).
 */
export const OG_COLORS = {
  ground: '#121110',
  raised: '#1B1A18',
  rule: '#3B3A35',
  ink: '#EDECE8',
  toned: '#C6C2B9',
  muted: '#9A968D',
  primary: '#8DB2DA',
  dirt: '#D2A24A',
  rough: '#D08C7A'
} as const

const FAMILY_COLORS: Record<SurfaceFamily, string> = { tarmac: OG_COLORS.rule, dirt: OG_COLORS.dirt, rough: OG_COLORS.rough }

/**
 * Heights per share-card Silhouette: the same shape every listing draws, at
 * the finer count a 1200 px card wants. The cards carry it through
 * `defineOgImage` as plain props - `routeSilhouette(route, laps, OG_SILHOUETTE_SAMPLES)`.
 */
export const OG_SILHOUETTE_SAMPLES = 120

const dataUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

/**
 * The Silhouette as an image for a card - passed to Takumi as a data-URI
 * `<img>` rather than inline SVG, the renderer's dependable path. The
 * outline in the ink over a faint fill - an unmeasured lead-in dashed, as on
 * the page - and the surface strip beneath in the two surface colours when
 * the positions are known.
 */
export function ogProfileImage(profile: Silhouette, width: number, height: number): string {
  const stripHeight = profile.surfaces.length ? 10 : 0
  const plotHeight = height - stripHeight - (stripHeight ? 8 : 0)
  const coordinates = (points: readonly { x: number, y: number }[]) => points
    .map(point => `${(point.x * width).toFixed(1)},${(plotHeight - 4 - point.y * (plotHeight - 12)).toFixed(1)}`).join(' ')
  const outline = silhouetteOutline(profile)
  const points = coordinates(outline)
  const lines = outlineRuns(outline, profile.approximatedUntil)
    .map(run => run.approximated
      ? `<polyline points="${coordinates(run.points)}" fill="none" stroke="${OG_COLORS.toned}" stroke-width="3" stroke-dasharray="10 8" stroke-linejoin="round"/>`
      : `<polyline points="${coordinates(run.points)}" fill="none" stroke="${OG_COLORS.ink}" stroke-width="3" stroke-linejoin="round"/>`)
    .join('')
  const strip = profile.surfaces
    .map(span => `<rect x="${(span.from * width).toFixed(1)}" y="${height - stripHeight}" width="${Math.max(1, (span.to - span.from) * width).toFixed(1)}" height="${stripHeight}" fill="${FAMILY_COLORS[span.family]}"/>`)
    .join('')
  return dataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<polygon points="0,${plotHeight} ${points} ${width},${plotHeight}" fill="${OG_COLORS.ink}" fill-opacity="0.1"/>`
    + lines
    + strip
    + `</svg>`)
}

/** The wordmark's profile-shaped mark, as the cards draw it. */
export const OG_MARK_IMAGE = dataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40" viewBox="0 0 30 20"><path d="M1 17 L7 9 L11 13 L17 3 L22 11 L25 8 L29 17 Z" fill="${OG_COLORS.primary}"/></svg>`)
