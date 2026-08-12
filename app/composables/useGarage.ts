const STORAGE_KEY = 'zwift-bikes:garage'
const WHEELS_STORAGE_KEY = 'zwift-bikes:garage-wheels'

/**
 * Tracks which bike frames the user says they own, and at what upgrade
 * level (1 = just unlocked, 5 = fully upgraded - see `classifyBikeFrame.ts`),
 * as well as which wheelsets they own (Zwift wheels don't have upgrade
 * levels, so ownership is just a flag - keyed by `Wheelset.key`).
 * Persisted to localStorage only (no backend/account system), so it's tied
 * to a single browser.
 */
export function useGarage() {
  const owned = useState<Record<number, number>>('garage-owned', () => ({}))
  const ownedWheels = useState<Record<string, true>>('garage-owned-wheels', () => ({}))

  function persist() {
    if (!import.meta.client) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(owned.value))
    localStorage.setItem(WHEELS_STORAGE_KEY, JSON.stringify(ownedWheels.value))
  }

  function loadStored<T extends object>(key: string): T {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : ({} as T)
    } catch {
      return {} as T
    }
  }

  /** Only reassigns when the stored content actually differs from current state - a fresh object
   * reference on every call (even when the content is identical, e.g. an empty garage) would trigger
   * any watcher on `owned`/`ownedWheels` needlessly on every mount. */
  function load() {
    if (!import.meta.client) return
    const nextOwned = loadStored<Record<number, number>>(STORAGE_KEY)
    if (JSON.stringify(nextOwned) !== JSON.stringify(owned.value)) owned.value = nextOwned
    const nextOwnedWheels = loadStored<Record<string, true>>(WHEELS_STORAGE_KEY)
    if (JSON.stringify(nextOwnedWheels) !== JSON.stringify(ownedWheels.value)) ownedWheels.value = nextOwnedWheels
  }

  /** Marks a frame as owned at the given level (1-5), or removes it when `level` is null. */
  function setOwned(frameId: number, level: number | null) {
    if (level === null) {
      const next = { ...owned.value }
      const remaining = Object.fromEntries(Object.entries(next).filter(([id]) => Number(id) !== frameId))
      owned.value = remaining
    } else {
      owned.value = { ...owned.value, [frameId]: Math.min(5, Math.max(1, level)) }
    }
    persist()
  }

  function isOwned(frameId: number): boolean {
    return frameId in owned.value
  }

  /** Marks a wheelset (by its `key`) as owned or not. */
  function setWheelOwned(key: string, isOwnedValue: boolean) {
    if (isOwnedValue) {
      ownedWheels.value = { ...ownedWheels.value, [key]: true }
    } else {
      const remaining = Object.fromEntries(Object.entries(ownedWheels.value).filter(([k]) => k !== key))
      ownedWheels.value = remaining
    }
    persist()
  }

  function isWheelOwned(key: string): boolean {
    return key in ownedWheels.value
  }

  return { owned, ownedWheels, load, setOwned, isOwned, setWheelOwned, isWheelOwned }
}
