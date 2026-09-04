import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useRecommendResults, type RecommendPage } from './useRecommendResults'

type Combo = { id: string }
const page = (ids: string[], hasMore = true): RecommendPage<Combo> => ({ combos: ids.map(id => ({ id })), pagination: { hasMore } })

/** A fetch whose response the test releases by hand, so two requests can be interleaved. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(first = page(['a1', 'a2'])) {
  const recommendData = ref<RecommendPage<Combo> | null>(first)
  const pending: ReturnType<typeof deferred<RecommendPage<Combo>>>[] = []
  const fetchPage = vi.fn(async () => {
    const d = deferred<RecommendPage<Combo>>()
    pending.push(d)
    return d.promise
  })
  const refresh = vi.fn(async () => {})
  const onResultsApplied = vi.fn()
  const results = useRecommendResults<Combo>({ recommendData, refresh, fetchPage, pageSize: 2, onResultsApplied })
  return { recommendData, pending, fetchPage, refresh, onResultsApplied, ...results }
}

const ids = (combos: Combo[]) => combos.map(c => c.id)

describe('useRecommendResults', () => {
  it('shows the first page immediately and appends on showMore', async () => {
    const r = setup()
    expect(ids(r.loadedCombos.value)).toEqual(['a1', 'a2'])
    expect(r.onResultsApplied).toHaveBeenCalledTimes(1)

    const more = r.showMore()
    expect(r.loadingMore.value).toBe(true)
    expect(r.fetchPage).toHaveBeenCalledWith(2, 2)
    r.pending[0]!.resolve(page(['a3', 'a4'], false))
    await more

    expect(ids(r.loadedCombos.value)).toEqual(['a1', 'a2', 'a3', 'a4'])
    expect(r.hasMore.value).toBe(false)
    expect(r.loadedPages.value).toBe(2)
    expect(r.loadingMore.value).toBe(false)
  })

  it('drops a showMore page that lands after the query changed (issue #153)', async () => {
    const r = setup()
    const more = r.showMore()

    // A control change while page 2 is in flight: the first page refetches
    // and lands first, under the new query.
    await r.refreshFirstPage()
    r.recommendData.value = page(['b1', 'b2'], true)
    await nextTick()
    expect(ids(r.loadedCombos.value)).toEqual(['b1', 'b2'])

    // Now the stale page 2 arrives, ranked under the OLD query, claiming no
    // more pages exist.
    r.pending[0]!.resolve(page(['a3', 'a4'], false))
    await more

    expect(ids(r.loadedCombos.value)).toEqual(['b1', 'b2'])
    expect(r.hasMore.value).toBe(true)
    expect(r.loadedPages.value).toBe(1)
    expect(r.loadingMore.value).toBe(false)
    // Applied once for the initial page, once for the fresh one - never for
    // the dropped page.
    expect(r.onResultsApplied).toHaveBeenCalledTimes(2)
  })

  it('reloads every expanded page in one swap and keeps the list length', async () => {
    const r = setup()
    const more = r.showMore()
    r.pending[0]!.resolve(page(['a3', 'a4'], true))
    await more

    const reload = r.reloadLoadedPages()
    expect(r.reloadingPages.value).toBe(true)
    expect(r.fetchPage).toHaveBeenLastCalledWith(2, 2)
    // The first page's refresh lands: the watcher must NOT apply it alone.
    r.recommendData.value = page(['c1', 'c2'], true)
    await nextTick()
    expect(ids(r.loadedCombos.value)).toEqual(['a1', 'a2', 'a3', 'a4'])

    r.pending[1]!.resolve(page(['c3', 'c4'], false))
    await reload
    expect(ids(r.loadedCombos.value)).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(r.hasMore.value).toBe(false)
    expect(r.loadedPages.value).toBe(2)
    expect(r.reloadingPages.value).toBe(false)
    expect(r.onResultsApplied).toHaveBeenCalledTimes(2)
  })

  it('ignores an older multi-page reload that lands after a newer one', async () => {
    const r = setup()
    const more = r.showMore()
    r.pending[0]!.resolve(page(['a3', 'a4'], true))
    await more

    const first = r.reloadLoadedPages()
    const second = r.reloadLoadedPages()
    r.recommendData.value = page(['d1', 'd2'], true)
    // The newer reload's deeper page answers first, then the older one's.
    r.pending[2]!.resolve(page(['d3', 'd4'], false))
    await second
    expect(ids(r.loadedCombos.value)).toEqual(['d1', 'd2', 'd3', 'd4'])

    r.pending[1]!.resolve(page(['x3', 'x4'], true))
    await first
    expect(ids(r.loadedCombos.value)).toEqual(['d1', 'd2', 'd3', 'd4'])
    expect(r.hasMore.value).toBe(false)
    expect(r.reloadingPages.value).toBe(false)
  })

  it('falls back to the first page when a deeper page fails to reload', async () => {
    const r = setup()
    const more = r.showMore()
    r.pending[0]!.resolve(page(['a3', 'a4'], true))
    await more

    const reload = r.reloadLoadedPages()
    r.recommendData.value = page(['e1', 'e2'], true)
    r.pending[1]!.reject(new Error('503'))
    await reload
    expect(ids(r.loadedCombos.value)).toEqual(['e1', 'e2'])
    expect(r.hasMore.value).toBe(true)
    expect(r.loadedPages.value).toBe(1)
  })

  it('clears the list when the page has no result to show', async () => {
    const r = setup()
    r.recommendData.value = null
    await nextTick()
    expect(r.loadedCombos.value).toEqual([])
    expect(r.hasMore.value).toBe(false)
  })
})
