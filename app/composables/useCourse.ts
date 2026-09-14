import type { InternalApi } from 'nitropack/types'
import type { RouteWithMeta } from '../../shared/types/catalog'
import type { RideCourse } from '../utils/recommendRequest'

type RouteLookup = InternalApi['/api/routes/:slug']['get']
/** What `/api/segments/:slug` answers: the segment's summary, with the synthetic segment-as-route it is ranked on riding along. */
export type SegmentLookup = InternalApi['/api/segments/:slug']['get']

/** One answered lookup. The summary is there for a segment only. */
interface CourseLookup {
  course: RouteWithMeta
  segment?: SegmentLookup
}

/**
 * The geometry behind a `RideCourse`: the route itself, or for a segment the
 * segment-as-route the server ranks against (`routeWithMetaForSegment`)
 * together with the segment's own summary, which a segment page needs
 * (`type`) before it can say what its Ride is.
 *
 * Two callers ask for one course: the page, for the identity the rider has
 * selected, and `useRecommendRequest`, for the identity its Applied Ranking
 * was computed over. On a route or segment page those are one key from first
 * to last; on a race page the selector runs ahead of the ranking, so the two
 * keys part on a group change and meet again when the ranking lands. Nuxt
 * shares one `useAsyncData` entry per key between its callers and warns in
 * dev when a second caller brings a different handler, so every lookup MUST
 * come through here - a page's own `useFetch` under the same key would be
 * that warning, and under a different key a second request.
 *
 * Keyed on the identity, so a change of identity is a change of key and Nuxt
 * fetches the new course by itself. It also seeds the new key with the OLD
 * key's data until that fetch lands, which is why nothing reads `course`
 * for a Ride without checking its slug against the identity it asked for -
 * `useRecommendRequest` does, and a page's template gates on the same data
 * it selected.
 */
export function useCourse(identity: () => RideCourse | undefined) {
  const current = computed(identity)
  const asyncData = useAsyncData<CourseLookup | null>(
    () => current.value ? `course-${current.value.kind}-${current.value.slug}` : 'course-none',
    async () => {
      const course = current.value
      if (!course) return null
      if (course.kind === 'segment') {
        const segment = await $fetch<SegmentLookup>(`/api/segments/${course.slug}`)
        return { course: segment.route, segment }
      }
      return { course: await $fetch<RouteLookup>(`/api/routes/${course.slug}`) }
    },
    {
      // A course is its key: the same slug always answers the same, so a key
      // this app has already answered - by the other caller, or by this one
      // before the selector moved away and back - is served rather than
      // fetched again. The recommend request needs the opposite rule
      // (`cachedRecommendToServe`), because its key outlives its query.
      getCachedData: (key, nuxtApp) => nuxtApp.payload.data[key] ?? nuxtApp.static.data[key],
      // And a fetch already in flight for the key is joined, never cancelled
      // and re-run: when a ranking lands before the page's lookup does, the
      // module's key moves onto exactly such a fetch.
      dedupe: 'defer'
    }
  )
  return {
    /** Awaited by a page alongside its recommend request - or before it, where the Ride depends on the answer. */
    ready: asyncData as Promise<unknown>,
    course: computed(() => asyncData.data.value?.course),
    /** The segment's summary - present under a segment identity only. */
    segment: computed(() => asyncData.data.value?.segment),
    error: asyncData.error
  }
}
