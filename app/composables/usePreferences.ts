const STORAGE_KEY = 'zwift-bikes:preferences'

/**
 * Small general-purpose UI preferences that should persist across visits
 * (as opposed to `useGarage`/`useRiderProfile`, which track "who you are"
 * data). Persisted to localStorage only.
 */
export function usePreferences() {
  const verifiedOnly = useState<boolean>('pref-verified-only', () => true)

  function persist() {
    if (!import.meta.client) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ verifiedOnly: verifiedOnly.value }))
  }

  function load() {
    if (!import.meta.client) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (typeof parsed.verifiedOnly === 'boolean') verifiedOnly.value = parsed.verifiedOnly
    } catch {
      // ignore corrupted storage
    }
  }

  function setVerifiedOnly(value: boolean) {
    verifiedOnly.value = value
    persist()
  }

  return { verifiedOnly, load, setVerifiedOnly }
}
