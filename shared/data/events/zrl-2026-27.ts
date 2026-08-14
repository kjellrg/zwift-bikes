import type { EventSeason } from '../../types/events'

/**
 * Zwift Racing League 2026/27, as published by WTRL.
 *
 * Sources (checked 2026-08-14):
 * - https://www.wtrl.racing/zwift-racing-league/  - season structure, round
 *   names and dates ("4 x 6-week rounds"), registration opening 18th August
 *   2026, categories AB and CD.
 * - https://www.wtrl.racing/zrl/schedule/2026/r1/ - Round 1's per-race
 *   schedule: format, world, course, laps, distance and elevation, listed
 *   separately for A/B and C/D. Note this page renders its schedule in
 *   JavaScript, so fetching the HTML gets a placeholder skeleton showing
 *   "TBC" - the real table is only visible in a browser.
 *
 * Round 1 is filled in. Rounds 2-4 have published dates but no routes or
 * formats yet; those stay `undefined` until WTRL publishes them, and
 * `getPublishableRaces()` keeps unannounced races off the sitemap and out of
 * the prerender list until then. The season page still lists them, since the
 * dates themselves are the thing riders plan around.
 *
 * Every Round 1 distance and elevation below agrees with this site's own
 * lead-in-plus-laps totals to within 0.2% and 0.3% respectively, which is what
 * cross-checks the route slugs and lap counts.
 *
 * Every race day is a Tuesday, weekly within a round; each round's sixth race
 * lands exactly on WTRL's published round end date, which is what cross-checks
 * the cadence below.
 *
 * When filling a race in, populate `routeSlug` (a real `zwift-data` slug),
 * `format`, `categoryLaps`, the official distance/elevation as published, a
 * `note`, the `sourceUrl` it came from, and bump `updatedAt`. Then run
 * `node scripts/validate-events.mjs`.
 */

const CHECKED = '2026-08-14'
const ANNOUNCED = '2026-08-14'
const R1_SCHEDULE = 'https://www.wtrl.racing/zrl/schedule/2026/r1/'

export const zrl202627: EventSeason = {
  slug: 'zrl-2026-27',
  label: '2026/27',
  seriesSlug: 'zrl',
  seriesName: 'Zwift Racing League',
  organizer: 'WTRL',
  organizerUrl: 'https://www.wtrl.racing/zwift-racing-league/',
  description: 'Team racing on Zwift across four six-week rounds, run by WTRL. Every race day, route and the fastest bike and wheel combo for it.',
  note: 'Round 1 is confirmed - routes, formats and lap counts are in, including the weeks where A/B and C/D ride different courses. Rounds 2-4 have dates but no routes yet; they are added here as WTRL announces each round.',
  rounds: [
    {
      number: 1,
      name: 'Fresh & Fast',
      startDate: '2026-09-22',
      endDate: '2026-10-27',
      races: [
        {
          slug: 'round-1-week-1',
          round: 1,
          week: 1,
          date: '2026-09-22',
          format: 'points',
          // All four categories ride the same race, so one group - which is
          // also what stops the page showing a pointless category selector.
          categories: [
            { cats: ['A', 'B', 'C', 'D'], routeSlug: 'montmartre-mixer', routeName: 'Montmartre Mixer', laps: 1, officialDistanceKm: 27.6, officialElevationM: 198.5, scoringSegmentsTbd: true }
          ],
          note: 'Every metre of Montmartre Mixer is cobbled, which makes this the wheel-choice race of the round: on cobbles rolling resistance is set purely by the wheel’s Crr class, and - counterintuitively - Road-class wheels roll fastest on them, not gravel ones. The frame barely affects rolling resistance at all here, so pick for aero and weight and let the wheels handle the surface.',
          powerups: 'None',
          sourceUrl: R1_SCHEDULE,
          updatedAt: ANNOUNCED
        },
        {
          slug: 'round-1-week-2',
          round: 1,
          week: 2,
          date: '2026-09-29',
          format: 'scratch',
          // Same route, different lap counts.
          categories: [
            { cats: ['A', 'B'], routeSlug: 'innsbruckring', routeName: 'Innsbruckring', laps: 4, officialDistanceKm: 35.4, officialElevationM: 308.8 },
            { cats: ['C', 'D'], routeSlug: 'innsbruckring', routeName: 'Innsbruckring', laps: 3, officialDistanceKm: 26.6, officialElevationM: 231.8 }
          ],
          note: 'Four laps of a short, rolling circuit for A/B and three for C/D, on almost entirely smooth tarmac. Nothing here rewards a specialist: it is a fast, draft-heavy scratch race where aerodynamics dominate and the climbing is too shallow to pay for a lightweight build.',
          powerups: 'None',
          sourceUrl: R1_SCHEDULE,
          updatedAt: ANNOUNCED
        },
        {
          slug: 'round-1-week-3',
          round: 1,
          week: 3,
          date: '2026-10-06',
          format: 'points',
          // Genuinely different routes per group, not just different laps.
          categories: [
            {
              cats: ['A', 'B'],
              routeSlug: 'makuri-40',
              routeName: 'Makuri 40',
              laps: 1,
              officialDistanceKm: 40.3,
              officialElevationM: 312.9,
              // The same five sprints score both ways.
              //
              // WTRL's "FWD" means forward (vs "rev" for reverse), so these map
              // to zwift-data's forward variants: village-sprint,
              // country-sprint, alley-sprint, castle-park-sprint, shisa-sprint
              // - whose whatsOnZwift URLs all end in /forward, confirming it.
              // Note makuri-40's own `segments` array lists the -rev variants
              // for three of them; WTRL's published direction wins here.
              //
              // None carry a `slug` because none have a page on this site yet:
              // the segment catalog is built from routes publishing positional
              // segmentsOnRoute data, and Makuri 40 publishes none. Once those
              // pages exist, set the forward slugs above to link them.
              falSegments: [
                { name: 'Village FWD Sprint', times: 1 },
                { name: 'Country FWD Sprint', times: 1 },
                { name: 'Alley FWD Sprint', times: 1 },
                { name: 'Castle Park FWD Sprint', times: 1 },
                { name: 'Shisa FWD Sprint', times: 1 }
              ],
              ftsSegments: [
                { name: 'Village FWD Sprint', times: 1 },
                { name: 'Country FWD Sprint', times: 1 },
                { name: 'Alley FWD Sprint', times: 1 },
                { name: 'Castle Park FWD Sprint', times: 1 },
                { name: 'Shisa FWD Sprint', times: 1 }
              ]
            },
            // zwift-data has no readable slug for Urumaze - the numeric id is
            // the real slug, not a placeholder.
            { cats: ['C', 'D'], routeSlug: '4092230492', routeName: 'Urumaze', laps: 1, officialDistanceKm: 24.8, officialElevationM: 193.4 }
          ],
          note: 'The two halves of the field ride genuinely different races this week. A/B get Makuri 40, where roughly a third of the route is off tarmac (22% gravel, 14% cobbles) and wheel Crr becomes the single biggest equipment decision; C/D get Urumaze, a clean, rolling lap where ordinary road aero wins.',
          powerups: 'None',
          sourceUrl: R1_SCHEDULE,
          updatedAt: ANNOUNCED
        },
        {
          slug: 'round-1-week-4',
          round: 1,
          week: 4,
          date: '2026-10-13',
          format: 'ttt',
          categories: [
            { cats: ['A', 'B', 'C', 'D'], routeSlug: 'figure-8-reverse', routeName: 'Watopia Figure 8 Reverse', laps: 1, officialDistanceKm: 29.9, officialElevationM: 254.2 }
          ],
          note: 'The only week of the round where TT bikes are legal - Zwift enables them, and gives them draft, for team time trials. Figure 8 Reverse is rolling rather than flat, with the Zwift KOM in both directions, so the fastest TT setup is the one that does not fall apart on the climbs.',
          powerups: 'None (PowerUps are disabled in TTTs)',
          sourceUrl: R1_SCHEDULE,
          updatedAt: ANNOUNCED
        },
        {
          slug: 'round-1-week-5',
          round: 1,
          week: 5,
          date: '2026-10-20',
          format: 'scratch',
          categories: [
            { cats: ['A', 'B', 'C', 'D'], routeSlug: 'green-to-screen', routeName: 'Green to Screen', laps: 1, officialDistanceKm: 28.7, officialElevationM: 211.8 }
          ],
          note: 'A straightforward road race on clean tarmac, with The Hill KOM and the Brooklyn Bridge KOM breaking up an otherwise rolling lap. TT bikes are disabled, so this comes down to the best aero road frame the rider owns.',
          powerups: 'None',
          sourceUrl: R1_SCHEDULE,
          updatedAt: ANNOUNCED
        },
        {
          slug: 'round-1-week-6',
          round: 1,
          week: 6,
          date: '2026-10-27',
          format: 'points',
          categories: [
            { cats: ['A', 'B'], routeSlug: 'radio-rendezvous', routeName: 'Radio Rendezvous', laps: 1, officialDistanceKm: 23.6, officialElevationM: 744.2, scoringSegmentsTbd: true },
            // WTRL lists C/D on a route that isn't in the public catalog, so
            // there's nothing to compute a ranking against - the group is still
            // shown, with its published figures and the reason why.
            { cats: ['C', 'D'], routeName: 'ZRL Exclusive Route', laps: 1, officialDistanceKm: 24.0, officialElevationM: 283.5, scoringSegmentsTbd: true }
          ],
          note: 'A/B close the round with a genuine mountain race - 744 m of climbing in 23.6 km, over 35 m/km, taking in four KOMs including the Radio Tower. Weight beats aerodynamics decisively at those gradients. C/D ride a ZRL-exclusive route that is not in the public route catalog, so no ranking can be computed for it.',
          powerups: 'None',
          sourceUrl: R1_SCHEDULE,
          updatedAt: ANNOUNCED
        }
      ]
    },
    {
      number: 2,
      name: 'Team Tempo',
      startDate: '2026-11-17',
      endDate: '2026-12-22',
      races: [
        { slug: 'round-2-week-1', round: 2, week: 1, date: '2026-11-17', categories: [], updatedAt: CHECKED },
        { slug: 'round-2-week-2', round: 2, week: 2, date: '2026-11-24', categories: [], updatedAt: CHECKED },
        { slug: 'round-2-week-3', round: 2, week: 3, date: '2026-12-01', categories: [], updatedAt: CHECKED },
        { slug: 'round-2-week-4', round: 2, week: 4, date: '2026-12-08', categories: [], updatedAt: CHECKED },
        { slug: 'round-2-week-5', round: 2, week: 5, date: '2026-12-15', categories: [], updatedAt: CHECKED },
        { slug: 'round-2-week-6', round: 2, week: 6, date: '2026-12-22', categories: [], updatedAt: CHECKED }
      ]
    },
    {
      number: 3,
      name: 'Racecraft Rush',
      startDate: '2027-01-12',
      endDate: '2027-02-16',
      races: [
        { slug: 'round-3-week-1', round: 3, week: 1, date: '2027-01-12', categories: [], updatedAt: CHECKED },
        { slug: 'round-3-week-2', round: 3, week: 2, date: '2027-01-19', categories: [], updatedAt: CHECKED },
        { slug: 'round-3-week-3', round: 3, week: 3, date: '2027-01-26', categories: [], updatedAt: CHECKED },
        { slug: 'round-3-week-4', round: 3, week: 4, date: '2027-02-02', categories: [], updatedAt: CHECKED },
        { slug: 'round-3-week-5', round: 3, week: 5, date: '2027-02-09', categories: [], updatedAt: CHECKED },
        { slug: 'round-3-week-6', round: 3, week: 6, date: '2027-02-16', categories: [], updatedAt: CHECKED }
      ]
    },
    {
      number: 4,
      name: 'Final Charge',
      startDate: '2027-03-02',
      endDate: '2027-04-06',
      races: [
        { slug: 'round-4-week-1', round: 4, week: 1, date: '2027-03-02', categories: [], updatedAt: CHECKED },
        { slug: 'round-4-week-2', round: 4, week: 2, date: '2027-03-09', categories: [], updatedAt: CHECKED },
        { slug: 'round-4-week-3', round: 4, week: 3, date: '2027-03-16', categories: [], updatedAt: CHECKED },
        { slug: 'round-4-week-4', round: 4, week: 4, date: '2027-03-23', categories: [], updatedAt: CHECKED },
        { slug: 'round-4-week-5', round: 4, week: 5, date: '2027-03-30', categories: [], updatedAt: CHECKED },
        { slug: 'round-4-week-6', round: 4, week: 6, date: '2027-04-06', categories: [], updatedAt: CHECKED }
      ]
    }
  ]
}
