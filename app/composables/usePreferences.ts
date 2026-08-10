const STORAGE_KEY = 'zwift-bikes:preferences'

/**
 * Small general-purpose UI preferences that should persist across visits
 * (as opposed to `useGarage`/`useRiderProfile`, which track "who you are"
 * data). Persisted to localStorage only.
 */
export function usePreferences() {
  const verifiedOnly = useState<boolean>('pref-verified-only', () => true)
  const myBikesOnly = useState<boolean>('pref-my-bikes-only', () => false)

  function persist() {
    if (!import.meta.client) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      verifiedOnly: verifiedOnly.value,
      myBikesOnly: myBikesOnly.value
    }))
  }

  function load() {
    if (!import.meta.client) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (typeof parsed.verifiedOnly === 'boolean') verifiedOnly.value = parsed.verifiedOnly
      if (typeof parsed.myBikesOnly === 'boolean') myBikesOnly.value = parsed.myBikesOnly
    } catch {
      // ignore corrupted storage
    }
  }

  function setVerifiedOnly(value: boolean) {
    verifiedOnly.value = value
    persist()
  }

  function setMyBikesOnly(value: boolean) {
    myBikesOnly.value = value
    persist()
  }

  return { verifiedOnly, myBikesOnly, load, setVerifiedOnly, setMyBikesOnly }
}
