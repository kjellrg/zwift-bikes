// The comparison behind `npm run dictionary:check` (see check-game-dictionary.mjs,
// which loads the live dictionary and the catalog and prints this module's
// report). Pure: it takes Zwift's game dictionary as parsed JSON and the
// catalog as plain data, so a test can hand it fixtures of either.

/** Zwift's unlocalised-name shape: `Factor LOC_ENTITLEMENT_..._NAME`, `Zwift LOC_WHEELNAME_ZWIFT_BigSpinCruiser2024`. */
export const PLACEHOLDER = /\bLOC_[A-Za-z0-9_]+/

/** Every kind of finding the check reports; an ACCEPTED_GAPS pattern must name one of these. */
export const FINDING_KINDS = new Set([
  'frame-rename', 'frame-is-tt', 'frame-not-in-dictionary', 'frame-not-in-catalog', 'provisional-has-record', 'unknown-lvid',
  'wheel-rename', 'wheel-image', 'wheel-not-in-dictionary', 'wheel-not-in-catalog', 'placeholder',
  'duplicate-name',
  'route-rename', 'route-length', 'route-event-only', 'route-not-in-dictionary', 'route-not-in-catalog',
  'override-not-event-only', 'override-redundant', 'override-without-route'
])

/** Route lengths closer than this agree: zwift-data rounds the dictionary's metres to whole metres in km. */
export const ROUTE_TOLERANCE_M = 10

const ROUTE_LENGTHS = [
  ['distance', 'distance', 'distanceInMeters'],
  ['lead-in', 'leadInDistance', 'leadinDistanceInMeters'],
  ['free-ride lead-in', 'leadInDistanceFreeRide', 'freeRideLeadinDistanceInMeters'],
  ['meetup lead-in', 'leadInDistanceMeetups', 'meetupLeadinDistanceInMeters']
]

/**
 * The game dictionary's `lvId` on a frame record names the Upgrade scheme the
 * frame is on (mapped 2026-10-09: 174 frames, 11 values, no disagreement with
 * `FRAME_UPGRADE_SCHEMES`). Halo upgrades exactly like high-end, which is how
 * the scheme table records it, so the two Halo lvIds read as `tier: 'high'`.
 * A record whose name is still a placeholder carries a default lvId, not its
 * scheme, so it is not read.
 */
export const LVID_SCHEMES = new Map([
  [28476688, { axis: 'distance', tier: 'entry' }],
  [3276754954, { axis: 'distance', tier: 'mid' }],
  [4169711732, { axis: 'distance', tier: 'high' }],
  [1060224344, { axis: 'distance', tier: 'high', halo: true }],
  [1650484229, { axis: 'duration', tier: 'entry' }],
  [4128915623, { axis: 'duration', tier: 'mid' }],
  [405837660, { axis: 'duration', tier: 'high' }],
  [3750357616, { axis: 'duration', tier: 'high', halo: true }],
  [3758744642, { axis: 'elevation', tier: 'entry' }],
  [2351078103, { axis: 'elevation', tier: 'mid' }],
  [1253068759, { axis: 'elevation', tier: 'high' }]
])

const quote = JSON.stringify

/**
 * Differences known and accepted, one reason each. A finding matching one of
 * an entry's patterns on every field the pattern names is listed as accepted
 * instead of failing the run, so each pattern pins the ids and names it
 * accepts: a further change to the same record is a new finding.
 */
export const ACCEPTED_GAPS = [
  {
    reason: 'zwift-data has only the run version of Hilltop Hustle; the cycling route has been missing upstream since it was published (2025-04-14), not lagging',
    findings: [{ kind: 'route-not-in-catalog', id: 3961473046, name: 'Hilltop Hustle' }]
  },
  {
    reason: 'the six event-only routes on the Gravel Mountain map, which zwift-data has no world for',
    findings: [
      { kind: 'route-not-in-catalog', id: 3687150686, name: 'Red Rock Loop' },
      { kind: 'route-not-in-catalog', id: 1437969615, name: 'Red Rock Loop Reverse' },
      { kind: 'route-not-in-catalog', id: 1295302121, name: 'Red Rock Loop Arcade' },
      { kind: 'route-not-in-catalog', id: 2273747093, name: 'Red Rock Loop Arcade 3' },
      { kind: 'route-not-in-catalog', id: 434255158, name: 'Red Rock Loop Arcade 4' },
      { kind: 'route-not-in-catalog', id: 967374265, name: 'Red Rock Run' }
    ]
  },
  {
    reason: 'the Big Spin Cruiser wheel is still a placeholder in the dictionary itself, so there is no real name to take yet',
    findings: [
      { kind: 'placeholder', group: 'front wheel', id: 2004537892, name: 'Zwift LOC_WHEELNAME_ZWIFT_BigSpinCruiser2024' },
      { kind: 'placeholder', group: 'rear wheel', id: 2740373137, name: 'Zwift LOC_WHEELNAME_ZWIFT_BigSpinCruiser2024' }
    ]
  },
  {
    reason: 'the older Shimano DURA-ACE revisions are withdrawn by id (wheelSupplement.ts, checked in game 2026-10-07), but the dictionary still lists them under the 2026 wheels\' names',
    findings: [
      { kind: 'duplicate-name', group: 'front wheel', name: 'Shimano DURA-ACE C36', ids: [304842870, 3842759965] },
      { kind: 'duplicate-name', group: 'front wheel', name: 'Shimano DURA-ACE C50', ids: [1742598126, 2489344011] },
      { kind: 'duplicate-name', group: 'front wheel', name: 'Shimano DURA-ACE C60', ids: [272842014, 3181958393] },
      { kind: 'duplicate-name', group: 'rear wheel', name: 'Shimano DURA-ACE C36', ids: [14115933, 1002105871] },
      { kind: 'duplicate-name', group: 'rear wheel', name: 'Shimano DURA-ACE C50', ids: [3673160473, 3725678091] },
      { kind: 'duplicate-name', group: 'rear wheel', name: 'Shimano DURA-ACE C60', ids: [1207119882, 3415380320] }
    ]
  },
  {
    // Name is the key of every speed-data and scheme table (see frameSupplement.ts).
    reason: 'the dictionary calls both Cervelo P5s plain "Cervelo P5"; the 2015 bike keeps that name and the 2026 bike keeps its year, so the two never share a table row (#314)',
    findings: [
      { kind: 'frame-rename', id: 1969226988, ours: 'Cervelo P5 2026', theirs: 'Cervelo P5' },
      { kind: 'duplicate-name', group: 'frame', name: 'Cervelo P5', ids: [1969226988, 3932292289] }
    ]
  },
  {
    reason: 'two novelty Zwift BigWheel records under one name, both shipped by zwift-data; the catalog lets the name be shared on purpose (KNOWN_SHARED_FRAME_NAMES, catalogNames.ts) and nothing measured or schemed is keyed on it',
    findings: [{ kind: 'duplicate-name', group: 'frame', name: 'Zwift BigWheel', ids: [2029842509, 3079625256] }]
  },
  {
    reason: 'the Zwift Concept wheels are the plain and Gold skins of one wheel on different imageNames, which getWheelsets() pairs front to rear by imageName (KNOWN_SHARED_WHEEL_NAMES, catalogNames.ts)',
    findings: [
      { kind: 'duplicate-name', group: 'front wheel', name: 'Zwift Concept', ids: [998391700, 1344753875] },
      { kind: 'duplicate-name', group: 'rear wheel', name: 'Zwift Concept', ids: [961116451, 4151822963] }
    ]
  }
]
const schemeName = scheme => `${scheme.axis} / ${scheme.tier}${scheme.halo ? ' (Halo)' : ''}`
const sameScheme = (a, b) => a.axis === b.axis && a.tier === b.tier

function records(dictionary, group, item) {
  return (dictionary.GameDictionary[group]?.[0]?.[item] ?? []).map(r => ({ ...r.$, id: Number(r.$.signature) }))
}

const normalize = name => name.toLowerCase().replace(/\s+/gu, ' ').trim()

/** Each equipment group's records in the dictionary: `GameDictionary.<GROUP>[0].<ITEM>[]`. */
const EQUIPMENT_GROUPS = new Map([
  ['frame', ['BIKEFRAMES', 'BIKEFRAME']],
  ['front wheel', ['BIKEFRONTWHEELS', 'BIKEFRONTWHEEL']],
  ['rear wheel', ['BIKEREARWHEELS', 'BIKEREARWHEEL']]
])
const equipment = (dictionary, group) => records(dictionary, ...EQUIPMENT_GROUPS.get(group))

/** The dictionary groups this check reads that `dictionary` lacks: a layout change, which the CLI refuses to guess past. */
export function missingGroups(dictionary) {
  return [...[...EQUIPMENT_GROUPS.values()].map(([group]) => group), 'ROUTES', 'PORTAL_SEGMENTS'].filter(group => !dictionary.GameDictionary?.[group]?.[0])
}

function checkDuplicateNames(dictionary, report) {
  for (const group of EQUIPMENT_GROUPS.keys()) {
    const byName = new Map()
    for (const record of equipment(dictionary, group)) {
      const key = normalize(record.name)
      byName.set(key, [...(byName.get(key) ?? []), record])
    }
    for (const same of byName.values()) {
      if (same.length < 2) continue
      // By id, so the name reported (and matched against ACCEPTED_GAPS) does
      // not depend on the dictionary's order when spellings differ in case.
      const [first, ...rest] = same.sort((a, b) => a.id - b.id)
      const ids = [first, ...rest].map(r => r.id)
      report.finding({ kind: 'duplicate-name', group, name: first.name, ids }, `dictionary ${group}s ${ids.join(' and ')} share the name ${quote(first.name)} - every name-keyed table would give them one row`)
    }
  }
}

/** Dictionary frames by normalised name, for matching a Provisional-id frame to the record that has since landed. */
const framesByName = dictFrames => new Map(dictFrames.map(r => [normalize(r.name), r]))

function checkFrames(dictionary, catalog, report) {
  const dictFrames = equipment(dictionary, 'frame')
  const byId = new Map(dictFrames.map(r => [r.id, r]))
  const byName = framesByName(dictFrames)
  const claimed = new Set(catalog.frames.map(f => f.id))
  for (const frame of catalog.frames) {
    const label = `frame ${quote(frame.name)} (id ${frame.id})`
    if (frame.provisional) {
      const match = byName.get(normalize(frame.name))
      if (match) {
        claimed.add(match.id)
        report.finding({ kind: 'provisional-has-record', name: frame.name, recordId: match.id }, `${label}: the dictionary now has a record for it (id ${match.id}, name ${quote(match.name)}) - take the real id`)
      } else {
        report.note(`${label}: provisional id, no dictionary record yet`)
      }
      continue
    }
    const record = byId.get(frame.id)
    if (!record) {
      report.finding({ kind: 'frame-not-in-dictionary', id: frame.id, name: frame.name }, `${label}: the dictionary no longer has this id - withdrawn, or the id was mistranscribed`)
      continue
    }
    const oursIsPlaceholder = PLACEHOLDER.test(frame.name)
    if (PLACEHOLDER.test(record.name)) {
      report.note(`${label}: the dictionary's name is still the placeholder ${quote(record.name)}${oursIsPlaceholder ? ', as in zwift-data' : ''}`)
    } else if (record.name !== frame.name) {
      const fix = oursIsPlaceholder
        ? 'zwift-data still ships the placeholder: add a SUPPLEMENT_FRAMES entry under the real name'
        : frame.source === 'supplement'
          ? 're-key the supplement entry, its speed data and its upgrade scheme'
          : 'add a rename entry to SUPPLEMENT_FRAMES and re-key its speed data and upgrade scheme'
      report.finding({ kind: 'frame-rename', id: frame.id, ours: frame.name, theirs: record.name }, `${label}: the dictionary now names it ${quote(record.name)} - ${fix}`)
    }
    if ((record.isTT === '1') !== frame.isTT) report.finding({ kind: 'frame-is-tt', id: frame.id }, `${label}: the dictionary says isTT=${record.isTT}, the catalog ${frame.isTT}`)
  }
  for (const record of dictFrames) {
    if (!claimed.has(record.id)) report.finding({ kind: 'frame-not-in-catalog', id: record.id, name: record.name }, `dictionary frame ${quote(record.name)} (id ${record.id}, isTT=${record.isTT}, modelYear=${record.modelYear}, lvId ${record.lvId}) is in neither zwift-data nor the supplement`)
  }
}

function checkWheels(dictionary, catalog, report) {
  for (const [group, wheels, withdrawn] of [
    ['front wheel', catalog.frontWheels, catalog.withdrawnFrontWheels],
    ['rear wheel', catalog.rearWheels, catalog.withdrawnRearWheels]
  ]) {
    const dictWheels = equipment(dictionary, group)
    const byId = new Map(dictWheels.map(r => [r.id, r]))
    // A withdrawal rests on an in-game check, not on the dictionary, which can
    // keep a record the game no longer offers - so it is noted, never failed.
    for (const wheel of withdrawn) {
      report.note(`${group} ${quote(wheel.name)} (id ${wheel.id}): withdrawn - ${byId.has(wheel.id) ? 'the dictionary still lists it' : 'the dictionary has dropped it too; delete the withdrawal once zwift-data does'}`)
    }
    for (const wheel of wheels) {
      const label = `${group} ${quote(wheel.name)} (id ${wheel.id})`
      const record = byId.get(wheel.id)
      if (!record) {
        report.finding({ kind: 'wheel-not-in-dictionary', group, id: wheel.id, name: wheel.name }, `${label}: the dictionary no longer has this id`)
        continue
      }
      const oursIsPlaceholder = PLACEHOLDER.test(wheel.name)
      if (PLACEHOLDER.test(record.name)) {
        // Unlike frames, a placeholder-named wheel is not hidden from the site.
        if (oursIsPlaceholder) report.finding({ kind: 'placeholder', group, id: wheel.id, name: wheel.name }, `${label}: a placeholder in zwift-data and the dictionary alike, and shown under it`)
        else report.note(`${label}: the dictionary's name is still the placeholder ${quote(record.name)}`)
      } else if (record.name !== wheel.name) {
        const fix = oursIsPlaceholder
          ? 'zwift-data still ships the placeholder: add a supplement entry under the real name'
          : wheel.source === 'supplement'
            ? 're-key the supplement entry and its speed data'
            : 'add a rename entry to the wheel supplement, re-key its speed data and add the old key to RENAMED_WHEELSET_KEYS'
        report.finding({ kind: 'wheel-rename', group, id: wheel.id, ours: wheel.name, theirs: record.name }, `${label}: the dictionary now names it ${quote(record.name)} - ${fix}`)
      }
      if (record.imageName !== wheel.imageName) report.finding({ kind: 'wheel-image', group, id: wheel.id }, `${label}: imageName is ${quote(record.imageName)} in the dictionary, ${quote(wheel.imageName)} in the catalog`)
    }
    const known = new Set([...wheels, ...withdrawn].map(w => w.id))
    for (const record of dictWheels) {
      if (!known.has(record.id)) report.finding({ kind: 'wheel-not-in-catalog', group, id: record.id, name: record.name }, `dictionary ${group} ${quote(record.name)} (id ${record.id}, image ${record.imageName}) is in neither zwift-data nor the supplement`)
    }
  }
}

// An override (routeEventLeadIns.ts) exists because a ridden distance or the
// dictionary disagrees with zwift-data, so a difference from the dictionary is
// expected and noted. It is a finding only once it has nothing left to
// correct, or corrects a route `eventLeadIn()` no longer applies it to.
// Returns whether the override carries the dictionary's own figure, in which
// case zwift-data lagging behind it is not a finding either.
function checkOverride(route, override, zwiftDataM, dictionaryM, report) {
  const overrideM = Math.round(override.distanceKm * 1000)
  const carriesDictionaryFigure = Math.abs(overrideM - dictionaryM) <= ROUTE_TOLERANCE_M
  const label = `event lead-in override for ${quote(route.name)} (${route.slug})`
  if (!route.eventOnly) {
    report.finding({ kind: 'override-not-event-only', slug: route.slug }, `${label}: the route is no longer event-only, so the override is not applied - delete it`)
  } else if (carriesDictionaryFigure && Math.abs(zwiftDataM - dictionaryM) <= ROUTE_TOLERANCE_M) {
    report.finding({ kind: 'override-redundant', slug: route.slug }, `${label}: zwift-data (${Math.round(zwiftDataM)} m) and the dictionary (${Math.round(dictionaryM)} m) both agree with its ${overrideM} m now - delete it`)
  } else if (carriesDictionaryFigure) {
    report.note(`route ${quote(route.name)}: lead-in is ${Math.round(zwiftDataM)} m in zwift-data, ${Math.round(dictionaryM)} m in the dictionary; the override carries the dictionary's figure until zwift-data catches up`)
  } else {
    report.note(`${label}: ${overrideM} m stands against the dictionary's ${Math.round(dictionaryM)} m (zwift-data ${Math.round(zwiftDataM)} m) - ${override.source}, checked ${override.checkedAt}`)
  }
  return carriesDictionaryFigure
}

function checkRoutes(dictionary, catalog, report) {
  const portalIds = new Set(records(dictionary, 'PORTAL_SEGMENTS', 'PORTAL_SEGMENT').map(p => Number(p.Hash)))
  // A climb portal is published as a ROUTE record under its segment's hash;
  // it is a segment, not a route, so it is not compared here.
  const dictRoutes = records(dictionary, 'ROUTES', 'ROUTE').filter(r => !portalIds.has(r.id))
  const byId = new Map(dictRoutes.map(r => [r.id, r]))
  for (const route of catalog.routes) {
    const record = byId.get(route.id)
    const label = `route ${quote(route.name)} (id ${route.id})`
    if (!record) {
      report.finding({ kind: 'route-not-in-dictionary', id: route.id, name: route.name }, `${label}: the dictionary no longer has this id`)
      continue
    }
    if (record.name !== route.name) report.finding({ kind: 'route-rename', id: route.id, ours: route.name, theirs: record.name }, `${label}: the dictionary now names it ${quote(record.name)}`)
    const override = catalog.eventLeadInOverrides[route.slug]
    for (const [field, ours, theirs] of ROUTE_LENGTHS) {
      // zwift-data omits a free-ride or meetup lead-in where the dictionary
      // has none or 0, so a missing figure on either side reads as 0 m.
      const oursM = (route[ours] ?? 0) * 1000
      const theirsM = Number(record[theirs] ?? 0)
      if (field === 'lead-in' && override && checkOverride(route, override, oursM, theirsM, report)) continue
      if (Math.abs(oursM - theirsM) > ROUTE_TOLERANCE_M) report.finding({ kind: 'route-length', id: route.id, field }, `${label}: ${field} is ${Math.round(oursM)} m in zwift-data, ${Math.round(theirsM)} m in the dictionary`)
    }
    if ((record.eventOnly === '1') !== route.eventOnly) report.finding({ kind: 'route-event-only', id: route.id }, `${label}: event-only is ${route.eventOnly} in zwift-data, ${record.eventOnly === '1'} in the dictionary`)
  }
  const slugs = new Set(catalog.routes.map(r => r.slug))
  for (const slug of Object.keys(catalog.eventLeadInOverrides)) {
    if (!slugs.has(slug)) report.finding({ kind: 'override-without-route', slug }, `event lead-in override ${quote(slug)}: no zwift-data route has this slug`)
  }
  const catalogIds = new Set(catalog.routes.map(r => r.id))
  for (const record of dictRoutes) {
    if (!catalogIds.has(record.id)) report.finding({ kind: 'route-not-in-catalog', id: record.id, name: record.name }, `dictionary route ${quote(record.name)} (id ${record.id}, eventOnly=${record.eventOnly}, sports=${record.sports}) is not in zwift-data`)
  }
}

function checkSchemes(dictionary, catalog, schemes, report) {
  const dictFrames = equipment(dictionary, 'frame')
  const byId = new Map(dictFrames.map(r => [r.id, r]))
  const byName = framesByName(dictFrames)
  for (const frame of catalog.frames) {
    const scheme = catalog.schemes[frame.name]
    // A Provisional-id frame is read off the record that has landed for it,
    // if one has ("take the real id" is reported by checkFrames).
    const record = frame.provisional ? byName.get(normalize(frame.name)) : byId.get(frame.id)
    if (frame.provisional && !record) {
      // Nothing to read a scheme off: the table entry is assigned by hand,
      // with a comment naming its source.
      if (scheme) {
        schemes.handAssigned.push({ frame, scheme })
        schemes.comparison.push({ frame, scheme, unread: 'assigned by hand: no dictionary record' })
      }
      continue
    }
    // A placeholder name on either side is a frame the site does not show
    // (ours) or a record whose lvId is still a default (theirs).
    if (!record || PLACEHOLDER.test(frame.name) || PLACEHOLDER.test(record.name)) {
      if (scheme) schemes.comparison.push({ frame, scheme, lvId: record?.lvId, unread: record ? 'placeholder name' : 'no dictionary record' })
      continue
    }
    const fromLvId = LVID_SCHEMES.get(Number(record.lvId))
    if (scheme) schemes.comparison.push({ frame, scheme, lvId: record.lvId, fromLvId, unread: fromLvId ? undefined : 'unknown lvId' })
    // A new lvId is a scheme Zwift added or renumbered: an upstream change,
    // so unlike a disagreement it fails the run until LVID_SCHEMES maps it.
    if (!fromLvId) report.finding({ kind: 'unknown-lvid', id: frame.id, lvId: record.lvId }, `frame ${quote(frame.name)} (id ${frame.id}): lvId ${record.lvId} is not in LVID_SCHEMES - map it to its scheme`)
    else if (scheme && !sameScheme(scheme, fromLvId)) schemes.disagreements.push({ frame, scheme, lvId: record.lvId, fromLvId })
    // A scheme matters only to a frame with stage data to shape (see
    // `UpgradeScheme.awaitingMeasurement`), so only a measured frame is
    // offered a line; the rest are counted.
    else if (!scheme && catalog.measuredFrameNames.has(frame.name)) schemes.suggestions.push({ frame, lvId: record.lvId, fromLvId })
    else if (!scheme) schemes.unmeasuredWithoutScheme.push(frame)
  }
}

/**
 * Compares the catalog with the dictionary. `acceptedGaps` is a list of
 * `{ reason, findings: [pattern] }`; a finding matching a pattern on every
 * field the pattern names is accepted rather than failing.
 */
export function checkDictionary(dictionary, catalog, acceptedGaps) {
  const all = []
  const notes = []
  const report = {
    finding: (subject, message) => {
      if (!FINDING_KINDS.has(subject.kind)) throw new Error(`unknown finding kind ${quote(subject.kind)}`)
      all.push({ ...subject, message })
    },
    note: message => notes.push(message)
  }
  const schemes = { comparison: [], disagreements: [], suggestions: [], handAssigned: [], unmeasuredWithoutScheme: [] }
  checkFrames(dictionary, catalog, report)
  checkWheels(dictionary, catalog, report)
  checkDuplicateNames(dictionary, report)
  checkRoutes(dictionary, catalog, report)
  checkSchemes(dictionary, catalog, schemes, report)

  const accepted = []
  const failing = []
  for (const finding of all) {
    const gap = acceptedGaps.find(g => g.findings.some(pattern => matches(finding, pattern)))
    if (gap) accepted.push({ finding, reason: gap.reason })
    else failing.push(finding)
  }
  const stale = acceptedGaps.flatMap(gap => gap.findings.filter(pattern => !all.some(f => matches(f, pattern))).map(pattern => ({ pattern, reason: gap.reason })))
  return { failing, accepted, stale, notes, schemes }
}

function matches(finding, pattern) {
  return Object.entries(pattern).every(([key, value]) => quote(finding[key]) === quote(value))
}

/** The printed report, and the exit code: 1 only when a finding is not an accepted gap. */
export function formatReport(result) {
  const lines = [...result.notes]
  if (result.accepted.length) {
    lines.push('', `Accepted gaps (${result.accepted.length}, known and not failing):`)
    for (const { finding, reason } of result.accepted) lines.push(`  ${finding.message}`, `    accepted: ${reason}`)
  }
  if (result.stale.length) {
    lines.push('', 'Accepted gaps that no longer occur - delete them from ACCEPTED_GAPS:')
    for (const { pattern } of result.stale) lines.push(`  ${quote(pattern)}`)
  }
  lines.push(...formatSchemes(result.schemes))
  if (result.failing.length) {
    lines.push('', `${result.failing.length} difference${result.failing.length === 1 ? '' : 's'} not on the accepted-gaps list:`)
    for (const finding of result.failing) lines.push(`  ${finding.message}`)
  } else {
    lines.push('', 'dictionary:check OK - nothing has changed that the accepted-gaps list does not cover')
  }
  return { text: lines.join('\n'), exitCode: result.failing.length ? 1 : 0 }
}

/** Suggestion line in the scheme table's own syntax, ready to paste. */
export function schemeLine(name, scheme, lvId) {
  return `'${name.replaceAll('\'', '\\\'')}': { axis: '${scheme.axis}', tier: '${scheme.tier}' },  // lvId ${lvId}${scheme.halo ? ' (Halo)' : ''}`
}

function formatSchemes(schemes) {
  const lines = ['', 'Upgrade schemes - reported for a decision, never failing the run:']
  const read = schemes.comparison.filter(row => !row.unread).length
  lines.push(`  ${read} scheme entries compared with the frame's lvId: ${schemes.disagreements.length} disagree${read < schemes.comparison.length ? `; ${schemes.comparison.length - read} could not be read (see --schemes)` : ''}`)
  if (schemes.disagreements.length) {
    lines.push('', 'Scheme disagreements (FRAME_UPGRADE_SCHEMES vs the scheme the dictionary\'s lvId names):')
    for (const { frame, scheme, lvId, fromLvId } of schemes.disagreements) lines.push(`  ${quote(frame.name)} (id ${frame.id}): the table says ${schemeName(scheme)}; lvId ${lvId} is ${schemeName(fromLvId)}`)
  }
  if (schemes.suggestions.length) {
    lines.push('', 'Measured frames with no scheme - add to FRAME_UPGRADE_SCHEMES:')
    for (const { frame, lvId, fromLvId } of schemes.suggestions) lines.push(`  ${schemeLine(frame.name, fromLvId, lvId)}`)
  }
  if (schemes.handAssigned.length) {
    lines.push('', 'Assigned by hand, not yet checked (provisional id, no dictionary record):')
    for (const { frame, scheme } of schemes.handAssigned) lines.push(`  ${quote(frame.name)}: ${schemeName(scheme)}`)
  }
  if (schemes.unmeasuredWithoutScheme.length) lines.push('', `${schemes.unmeasuredWithoutScheme.length} unmeasured frames have no scheme; one is inert until the frame is measured.`)
  return lines
}

/** Every schemed catalog frame's FRAME_UPGRADE_SCHEMES entry beside the scheme its lvId names, as a Markdown table. */
export function formatSchemeComparison(result) {
  const rows = [...result.schemes.comparison].sort((a, b) => a.frame.name.localeCompare(b.frame.name))
  const lines = [
    `Scheme comparison: ${rows.length} frames, ${result.schemes.disagreements.length} disagreeing`,
    '',
    '| Frame | id | FRAME_UPGRADE_SCHEMES | lvId | lvId\'s scheme | Agrees |',
    '|---|---|---|---|---|---|'
  ]
  for (const { frame, scheme, lvId, fromLvId, unread } of rows) {
    const table = `${schemeName(scheme)}${scheme.awaitingMeasurement ? ' (awaiting measurement)' : ''}`
    const agrees = unread ? '-' : sameScheme(scheme, fromLvId) ? 'yes' : '**no**'
    lines.push(`| ${frame.name} | ${frame.id} | ${table} | ${lvId ?? '-'} | ${unread ? `not read: ${unread}` : schemeName(fromLvId)} | ${agrees} |`)
  }
  return lines.join('\n')
}
