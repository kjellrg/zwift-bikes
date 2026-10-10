/**
 * What a World page says about itself (#58), stated once for the page and
 * its twin the way a Ride statement is for a Ranking page (#318): the H1,
 * the counts line beneath it, and the head's title and description. The
 * twin quotes the same object, so the two cannot drift.
 */
export interface WorldStatementInputs {
  name: string
  routes: number
  climbs: number
  sprints: number
}

export interface WorldStatement {
  /** "Every Zwift route in Watopia" - the H1 and the twin's title. */
  heading: string
  /** "110 routes, 28 climbs and sprints" - the line under the H1. */
  countLine: string
  title: string
  description: string
}

const counted = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`

/**
 * The counts line states the whole world rather than a result, so it has no
 * "found". A world with only one kind of segment names that kind ("1
 * climb"), and one with none says nothing about segments: a "0 climbs and
 * sprints" clause would announce a section the page does not have.
 */
export function worldCountLine({ routes, climbs, sprints }: Omit<WorldStatementInputs, 'name'>): string {
  const segments = climbs && sprints
    ? `${climbs + sprints} climbs and sprints`
    : climbs ? counted(climbs, 'climb') : sprints ? counted(sprints, 'sprint') : undefined
  return [counted(routes, 'route'), segments].filter(Boolean).join(', ')
}

export function worldStatement(inputs: WorldStatementInputs): WorldStatement {
  const countLine = worldCountLine(inputs)
  return {
    heading: `Every Zwift route in ${inputs.name}`,
    countLine,
    title: `${inputs.name} routes, ranked by bike | ZwiftBikes`,
    description: `Every Zwift route in ${inputs.name} – ${countLine} – each ranked by the bike and wheel combo our physics model predicts fastest for your rider profile.`
  }
}
