import { afterEach, describe, expect, it, vi } from 'vitest'
import { RECOMMEND_MAX_LIMIT } from '#shared/utils/recommendLimits'
import { computed, effectScope, nextTick, onScopeDispose, ref, watch } from 'vue'
import { useRecommendRequest, type RecommendResponse } from './useRecommendRequest'
import { useRecommendationAnswer } from './useRecommendationAnswer'
import type { RecommendEnvelope, Ride } from '../utils/recommendRequest'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

const page = (time: number, note: string): RecommendResponse => ({
  combos: [{ frame: { name: 'Test frame' }, finishTimeSec: time } as RecommendResponse['combos'][number]],
  physics: { mode: 'solo', note },
  fastestOverall: { frameName: `${note} frame`, category: 'tt', reason: 'category', deltaSec: 5 },
  pagination: { hasMore: true }
})

function setup(cached?: { envelope: RecommendEnvelope<RecommendResponse>, hydrating: boolean }) {
  const owned = ref<Record<number, number>>({})
  const ownedWheels = ref<Record<string, true>>({})
  const powerW = ref(200)
  const verifiedOnly = ref(true)
  const includeHaloBikes = ref(false)
  const bikeCategory = ref('standard')
  const ride = ref<Ride>({ endpoint: '/api/recommend/test', laps: 1 })
  const scope = effectScope()
  let readEnvelope: () => RecommendEnvelope<RecommendResponse> | undefined = () => undefined
  const pending: ReturnType<typeof deferred<RecommendResponse>>[] = []
  const fetch = vi.fn((_endpoint: string, _options: { query: Record<string, unknown> & { offset: number } }) => {
    const request = deferred<RecommendResponse>()
    pending.push(request)
    return request.promise
  })
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('nextTick', nextTick)
  vi.stubGlobal('onScopeDispose', onScopeDispose)
  vi.stubGlobal('onMounted', vi.fn())
  vi.stubGlobal('$fetch', fetch)
  vi.stubGlobal('useRefetchNotice', vi.fn())
  vi.stubGlobal('useGarage', () => ({ owned, ownedWheels, load: vi.fn() }))
  vi.stubGlobal('useRiderProfile', () => ({
    weightKg: ref(75), heightCm: ref(175), powerW, sprintPowerW: ref(500),
    defaultUnownedLevel: ref(5), draftMode: ref('solo'), tttRiders: ref(4), tttClimbWkg: ref(undefined), load: vi.fn()
  }))
  vi.stubGlobal('usePreferences', () => ({
    verifiedOnly, myBikesOnly: ref(true), bikeCategory, includeHaloBikes, load: vi.fn()
  }))
  vi.stubGlobal('useAsyncData', (key: string, handler: () => Promise<RecommendEnvelope<RecommendResponse>>, options: {
    getCachedData: (key: string, app: unknown, context: { cause: string }) => RecommendEnvelope<RecommendResponse> | undefined
  }) => {
    const data = ref<RecommendEnvelope<RecommendResponse>>()
    readEnvelope = () => data.value
    const status = ref('pending')
    const error = ref<unknown>()
    let execution = 0
    const refresh = async () => {
      const token = ++execution
      status.value = 'pending'
      try {
        const response = await handler()
        if (token !== execution) return
        data.value = response
        status.value = 'success'
        error.value = undefined
      } catch (failure) {
        if (token !== execution) return
        data.value = undefined
        status.value = 'error'
        error.value = failure
      }
    }
    const entry = options.getCachedData(key, {
      isHydrating: cached?.hydrating ?? false,
      payload: { data: { [key]: cached?.hydrating ? cached.envelope : undefined } },
      static: { data: { [key]: cached?.hydrating ? undefined : cached?.envelope } }
    }, { cause: 'initial' })
    if (entry) {
      data.value = entry
      status.value = 'success'
    }
    const ready = entry ? Promise.resolve() : refresh()
    return Object.assign(ready, { data, status, error, refresh })
  })
  const request = scope.run(() => useRecommendRequest(() => ride.value, { key: 'test' }))!
  const answer = scope.run(() => useRecommendationAnswer({
    combo: () => request.topCombo.value,
    rideName: () => 'Test route',
    distanceKm: () => 1,
    rider: () => request.appliedInputs.value,
    restrictions: () => request.appliedRestrictions.value
  }))!
  scopes.push(scope)
  const payload = () => JSON.parse(JSON.stringify(readEnvelope())) as RecommendEnvelope<RecommendResponse>
  return { request, answer, owned, ownedWheels, powerW, verifiedOnly, includeHaloBikes, bikeCategory, ride, pending, fetch, payload }
}

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.unstubAllGlobals()
})

async function settle() {
  for (let turn = 0; turn < 8; turn++) await nextTick()
}

async function expanded() {
  const test = setup()
  test.pending[0]!.resolve(page(100, 'Original physics'))
  await test.request.ready
  await settle()
  const more = test.request.showMore()
  test.pending[1]!.resolve(page(110, 'Original physics'))
  await more
  return test
}

const times = (test: ReturnType<typeof setup>) => test.request.combos.value.map(combo => combo.finishTimeSec)

describe('useRecommendRequest applied ranking', () => {
  it('hydrates the rendered provenance before fetching the stored rider and preserves it on failure', async () => {
    const rendered = await expanded()
    rendered.powerW.value = 250
    await nextTick()
    rendered.pending[2]!.resolve(page(80, 'Rendered physics'))
    await settle()
    const test = setup({ envelope: rendered.payload(), hydrating: true })
    await test.request.ready
    expect(test.fetch).not.toHaveBeenCalled()
    expect(test.request.appliedInputs.value.powerW).toBe(250)
    expect(times(test)).toEqual([80])
    expect(test.request.canShowMore.value).toBe(false)
    test.powerW.value = 300
    await nextTick()
    test.pending[0]!.reject(new Error('Post-hydration failed'))
    await settle()
    expect(times(test)).toEqual([80])
    expect(test.request.appliedInputs.value.powerW).toBe(250)
  })

  it('reuses a matching navigation payload but fetches when rider provenance differs', async () => {
    const rendered = await expanded()
    const matching = setup({ envelope: rendered.payload(), hydrating: false })
    await matching.request.ready
    expect(matching.fetch).not.toHaveBeenCalled()
    expect(times(matching)).toEqual([100])
    matching.powerW.value = 250
    await nextTick()
    matching.pending[0]!.resolve(page(80, 'Different rider'))
    await settle()
    const mismatch = setup({ envelope: matching.payload(), hydrating: false })
    expect(mismatch.fetch).toHaveBeenCalledTimes(1)
    mismatch.pending[0]!.resolve(page(100, 'Requested rider'))
    await mismatch.request.ready
    expect(mismatch.request.appliedInputs.value.powerW).toBe(200)
    expect(mismatch.request.physics.value?.note).toBe('Requested rider')
  })

  it('keeps the latest complete Garage refresh when older pages arrive afterward', async () => {
    const test = await expanded()
    test.owned.value = { 12: 3 }
    await nextTick()
    test.owned.value = { 12: 4 }
    await nextTick()
    test.pending[4]!.resolve(page(80, 'Latest physics'))
    test.pending[5]!.resolve(page(85, 'Latest physics'))
    await settle()
    expect(times(test)).toEqual([80, 85])
    test.pending[2]!.resolve(page(90, 'Superseded physics'))
    test.pending[3]!.resolve(page(95, 'Superseded physics'))
    await settle()
    expect(times(test)).toEqual([80, 85])
    expect(test.request.physics.value?.note).toBe('Latest physics')
    expect(test.request.appliedRestrictions.value.owned[12]).toBe(4)
  })

  it('keeps expanded rows and their physics together until every Garage refresh page succeeds', async () => {
    const test = await expanded()
    const previousAnswer = test.answer.value?.text
    test.owned.value = { 12: 3 }
    await nextTick()
    const firstPageIndex = test.fetch.mock.calls.findIndex((call, index) => index >= 2 && call[1].query.offset === 0)
    test.pending[firstPageIndex]!.resolve(page(90, 'New physics'))
    await nextTick()
    await nextTick()
    expect(test.request.combos.value.map(combo => combo.finishTimeSec)).toEqual([100, 110])
    expect(test.request.physics.value?.note).toBe('Original physics')
    expect(test.request.fastestOverall.value?.frameName).toBe('Original physics frame')
    expect(test.answer.value?.text).toBe(previousAnswer)
    expect(test.request.appliedRestrictions.value.owned).toEqual({})
    expect(test.request.isRefreshing.value).toBe(true)
    expect(test.request.canShowMore.value).toBe(false)
    test.pending[3]!.resolve(page(95, 'New physics'))
    await settle()
    expect(times(test)).toEqual([90, 95])
    expect(test.request.physics.value?.note).toBe('New physics')
    expect(test.request.fastestOverall.value?.frameName).toBe('New physics frame')
    expect(test.request.appliedRestrictions.value.owned).toEqual({ 12: 3 })
    expect(test.answer.value?.text).not.toBe(previousAnswer)
    expect(test.request.isRefreshing.value).toBe(false)
  })

  it('retains every expanded page and its explanation when a required page fails', async () => {
    const test = await expanded()
    const previousAnswer = test.answer.value?.text
    test.owned.value = { 12: 3 }
    await nextTick()
    test.pending[2]!.resolve(page(90, 'New physics'))
    test.pending[3]!.reject(new Error('Deeper page failed'))
    await settle()
    expect(times(test)).toEqual([100, 110])
    expect(test.answer.value?.text).toBe(previousAnswer)
    expect(test.request.physics.value?.note).toBe('Original physics')
    expect(test.request.canShowMore.value).toBe(false)
    expect(test.request.resultsAnnouncement.value).toBe('')
    test.owned.value = { 12: 4 }
    await nextTick()
    expect(test.pending).toHaveLength(6)
    test.pending[4]!.resolve(page(80, 'Complete physics'))
    test.pending[5]!.resolve(page(85, 'Complete physics'))
    await settle()
    expect(times(test)).toEqual([80, 85])
  })

  it('clears an earlier success announcement when the next refresh fails', async () => {
    const test = await expanded()
    test.powerW.value = 250
    await nextTick()
    test.pending[2]!.resolve(page(80, 'New physics'))
    await settle()
    expect(test.request.resultsAnnouncement.value).toBe('Results updated')
    test.powerW.value = 300
    await nextTick()
    test.pending[3]!.reject(new Error('Refresh failed'))
    await settle()
    expect(test.request.resultsAnnouncement.value).toBe('')
  })

  it('retains the complete ranking when the first refresh page fails after the deeper page succeeds', async () => {
    const test = await expanded()
    test.ownedWheels.value = { test: true }
    await nextTick()
    test.pending[3]!.resolve(page(85, 'Deeper physics'))
    test.pending[2]!.reject(new Error('First page failed'))
    await settle()
    expect(times(test)).toEqual([100, 110])
    expect(test.request.appliedRestrictions.value.ownedWheels).toEqual({})
    expect(test.request.fastestOverall.value?.frameName).toBe('Original physics frame')
    expect(test.request.physics.value?.note).toBe('Original physics')
  })

  it('clears a populated ranking for an unsupported group and ignores its pending expansion', async () => {
    const test = await expanded()
    const more = test.request.showMore()
    test.ride.value = { endpoint: undefined }
    await settle()
    expect(times(test)).toEqual([])
    expect(test.request.recommendData.value).toBeNull()
    expect(test.request.canShowMore.value).toBe(false)
    test.pending[2]!.resolve(page(120, 'Old group'))
    await more
    expect(times(test)).toEqual([])
    expect(test.request.appliedRide.value.endpoint).toBeUndefined()
  })

  it.each(['success', 'failure'])('ignores a superseded %s when the latest request fails', async (outcome) => {
    const test = await expanded()
    test.powerW.value = 250
    await nextTick()
    test.powerW.value = 300
    await nextTick()
    test.pending[3]!.reject(new Error('Latest failed'))
    await settle()
    if (outcome === 'success') test.pending[2]!.resolve(page(70, 'Superseded physics'))
    else test.pending[2]!.reject(new Error('Superseded failed'))
    await settle()
    expect(times(test)).toEqual([100, 110])
    expect(test.request.appliedInputs.value.powerW).toBe(200)
    expect(test.request.physics.value?.note).toBe('Original physics')
    expect(test.request.canShowMore.value).toBe(false)
    expect(test.request.resultsAnnouncement.value).toBe('')
    // The failure the rider is being shown is the latest request's; the
    // superseded one has no say either way.
    expect(test.request.refreshFailed.value).toBe(true)
  })

  it('resets only on acceptance and ignores late expansion under the old inputs', async () => {
    const test = await expanded()
    const more = test.request.showMore()
    test.powerW.value = 250
    await nextTick()
    expect(times(test)).toEqual([100, 110])
    expect(test.request.appliedInputs.value.powerW).toBe(200)
    test.pending[3]!.resolve(page(80, 'New physics'))
    await settle()
    test.pending[2]!.resolve(page(120, 'Original physics'))
    await more
    expect(times(test)).toEqual([80])
    expect(test.request.appliedInputs.value.powerW).toBe(250)
    expect(test.request.physics.value?.note).toBe('New physics')
  })

  it('retries a failed expansion from the same position using applied inputs', async () => {
    const test = await expanded()
    const more = test.request.showMore()
    test.pending[2]!.reject(new Error('Expansion failed'))
    await more
    expect(times(test)).toEqual([100, 110])
    expect(test.request.canShowMore.value).toBe(true)
    const retry = test.request.showMore()
    expect(test.fetch.mock.calls[3]?.[1]).toEqual(test.fetch.mock.calls[2]?.[1])
    test.pending[3]!.resolve(page(120, 'Original physics'))
    await retry
    expect(times(test)).toEqual([100, 110, 120])
  })

  it('accepts empty search results with new restrictions and clears unsupported groups', async () => {
    const test = await expanded()
    test.request.bikeSearchDebounced.value = 'No matching bike'
    test.verifiedOnly.value = false
    test.includeHaloBikes.value = true
    await nextTick()
    expect(test.request.appliedRestrictions.value.search).toBe('')
    test.pending[2]!.resolve({ combos: [], pagination: { hasMore: false } })
    await settle()
    expect(times(test)).toEqual([])
    expect(test.request.appliedRestrictions.value.search).toBe('No matching bike')
    expect(test.request.appliedRestrictions.value.verifiedOnly).toBe(false)
    expect(test.request.appliedRestrictions.value.includeHaloBikes).toBe(true)
    expect(test.request.hasMore.value).toBe(false)
    test.ride.value = { endpoint: undefined }
    await settle()
    expect(test.request.recommendData.value).toBeNull()
    expect(test.request.appliedRide.value.endpoint).toBeUndefined()
    expect(test.fetch).toHaveBeenCalledTimes(3)
  })

  it('reports a failed required refresh until a later one is accepted', async () => {
    const test = await expanded()
    expect(test.request.refreshFailed.value).toBe(false)
    test.owned.value = { 12: 3 }
    await nextTick()
    test.pending[2]!.resolve(page(90, 'New physics'))
    test.pending[3]!.reject(new Error('Deeper page failed'))
    await settle()
    expect(test.request.refreshFailed.value).toBe(true)
    expect(test.request.isRefreshing.value).toBe(false)
    expect(times(test)).toEqual([100, 110])
    test.owned.value = { 12: 4 }
    await nextTick()
    expect(test.request.refreshFailed.value).toBe(false)
    test.pending[4]!.resolve(page(80, 'Complete physics'))
    test.pending[5]!.resolve(page(85, 'Complete physics'))
    await settle()
    expect(test.request.refreshFailed.value).toBe(false)
    expect(times(test)).toEqual([80, 85])
  })

  it('retries every page the refresh requires, under the latest choices, and keeps the ranking when it fails again', async () => {
    const test = await expanded()
    test.owned.value = { 12: 3 }
    await nextTick()
    test.pending[2]!.resolve(page(90, 'New physics'))
    test.pending[3]!.reject(new Error('Deeper page failed'))
    await settle()
    expect(times(test)).toEqual([100, 110])

    const failedRetry = test.request.retry()
    await settle()
    expect(test.fetch.mock.calls.slice(4).map(call => call[1].query.offset)).toEqual([0, RECOMMEND_MAX_LIMIT])
    expect(JSON.parse(String(test.fetch.mock.calls[4]![1].query.owned))).toEqual({ 12: 3 })
    test.pending[4]!.resolve(page(70, 'Retry physics'))
    test.pending[5]!.reject(new Error('Deeper page failed again'))
    await failedRetry
    await settle()
    expect(times(test)).toEqual([100, 110])
    expect(test.request.physics.value?.note).toBe('Original physics')
    expect(test.request.refreshFailed.value).toBe(true)

    const retry = test.request.retry()
    test.pending[6]!.resolve(page(70, 'Retry physics'))
    test.pending[7]!.resolve(page(75, 'Retry physics'))
    await retry
    await settle()
    expect(times(test)).toEqual([70, 75])
    expect(test.request.refreshFailed.value).toBe(false)
  })

  it('announces the ranking a rider had to ask for again, and stays silent on a first load nobody asked twice for', async () => {
    const quiet = setup()
    quiet.pending[0]!.resolve(page(100, 'First physics'))
    await quiet.request.ready
    await settle()
    expect(times(quiet)).toEqual([100])
    expect(quiet.request.resultsAnnouncement.value).toBe('')

    const test = setup()
    test.pending[0]!.reject(new Error('First load failed'))
    await settle()
    expect(test.request.refreshFailed.value).toBe(true)
    expect(test.request.resultsAnnouncement.value).toBe('')
    const retry = test.request.retry()
    test.pending[1]!.resolve(page(100, 'Recovered physics'))
    await retry
    await settle()
    expect(times(test)).toEqual([100])
    expect(test.request.resultsAnnouncement.value).toBe('Results updated')
  })

  it('reports a failed expansion, keeps the rows and the position, and clears it on the next attempt', async () => {
    const test = await expanded()
    expect(test.request.expansionFailed.value).toBe(false)
    const more = test.request.showMore()
    test.pending[2]!.reject(new Error('Expansion failed'))
    await more
    expect(test.request.expansionFailed.value).toBe(true)
    expect(test.request.refreshFailed.value).toBe(false)
    expect(times(test)).toEqual([100, 110])
    expect(test.request.canShowMore.value).toBe(true)

    const retry = test.request.showMore()
    expect(test.request.expansionFailed.value).toBe(false)
    expect(test.fetch.mock.calls[3]?.[1]).toEqual(test.fetch.mock.calls[2]?.[1])
    test.pending[3]!.resolve(page(120, 'Original physics'))
    await retry
    expect(times(test)).toEqual([100, 110, 120])
    expect(test.request.expansionFailed.value).toBe(false)
  })

  it('drops a failed expansion when a new ranking is accepted', async () => {
    const test = await expanded()
    const more = test.request.showMore()
    test.pending[2]!.reject(new Error('Expansion failed'))
    await more
    expect(test.request.expansionFailed.value).toBe(true)
    test.powerW.value = 250
    await nextTick()
    test.pending[3]!.resolve(page(80, 'New physics'))
    await settle()
    expect(times(test)).toEqual([80])
    expect(test.request.expansionFailed.value).toBe(false)
  })

  it('asks for wheel alternatives under the Applied Ranking while the controls run ahead of it', async () => {
    const test = await expanded()
    test.powerW.value = 250
    await nextTick()
    const held = test.request.loadWheelOptions(12)
    const heldCall = test.fetch.mock.calls.at(-1)!
    expect(heldCall[1].query).toMatchObject({ powerW: 200, wheelsForFrame: 12, offset: 0 })
    test.pending.at(-1)!.resolve(page(105, 'Applied wheels'))
    expect((await held)?.map(combo => combo.finishTimeSec)).toEqual([105])

    // The refresh the slider fired is the earlier request; the drill-down
    // above is the later one.
    test.pending[2]!.reject(new Error('Refresh failed'))
    await settle()
    expect(test.request.refreshFailed.value).toBe(true)
    const afterFailure = test.request.loadWheelOptions(12)
    expect(test.fetch.mock.calls.at(-1)![1].query).toMatchObject({ powerW: 200, wheelsForFrame: 12 })
    test.pending.at(-1)!.resolve(page(105, 'Applied wheels'))
    expect((await afterFailure)?.map(combo => combo.finishTimeSec)).toEqual([105])
  })

  it('keeps wheel alternatives through a Show more, which grows the ranking rather than replacing it', async () => {
    const test = setup()
    test.pending[0]!.resolve(page(100, 'Original physics'))
    await test.request.ready
    await settle()
    const options = test.request.loadWheelOptions(12)
    const more = test.request.showMore()
    test.pending[2]!.resolve(page(110, 'Original physics'))
    await more
    expect(times(test)).toEqual([100, 110])
    test.pending[1]!.resolve(page(105, 'Applied wheels'))
    expect((await options)?.map(combo => combo.finishTimeSec)).toEqual([105])
  })

  it('discards wheel alternatives that arrive under a ranking no longer on screen', async () => {
    const test = await expanded()
    const late = test.request.loadWheelOptions(12)
    test.powerW.value = 250
    await nextTick()
    test.pending[3]!.resolve(page(80, 'New physics'))
    await settle()
    expect(times(test)).toEqual([80])
    test.pending[2]!.resolve(page(105, 'Superseded wheels'))
    expect(await late).toBeNull()
  })

  it('captures legal rider substitutions and detaches Garage input before fetching', async () => {
    const test = await expanded()
    test.bikeCategory.value = 'tt'
    test.ride.value = { endpoint: '/api/recommend/sprint', power: 'sprint', ttFramesAllowed: false, draftingAllowed: false }
    test.owned.value = { 12: 3 }
    await nextTick()
    test.pending[2]!.resolve(page(50, 'Sprint physics'))
    await settle()
    expect(test.request.appliedInputs.value).toMatchObject({ powerW: 500, category: 'all', draftMode: 'solo' })
    test.owned.value[12] = 4
    expect(test.request.appliedRestrictions.value.owned[12]).toBe(3)
  })
})
