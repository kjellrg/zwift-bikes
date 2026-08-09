const STORAGE_KEY = 'zwift-bikes:rider-profile'

const DEFAULT_WEIGHT_KG = 75
const DEFAULT_FTP_WATTS = 225
const DEFAULT_WKG = DEFAULT_FTP_WATTS / DEFAULT_WEIGHT_KG
const DEFAULT_UNOWNED_LEVEL = 0

/**
 * Tracks the rider's weight, FTP (functional threshold power, in watts) and
 * sustained power (as W/kg, matching how Zwift riders usually think about
 * effort) used to estimate finish times. `wkg` is normally kept in sync with
 * `ftpWatts / weightKg` (see `setWeightKg`/`setFtpWatts`, used by the "My
 * Profile" page), but can also be overridden directly per-route (see
 * `setWkg`, used by the route page's power slider) without touching the
 * stored FTP. Persisted to localStorage only.
 */
export function useRiderProfile() {
  const weightKg = useState<number>('rider-weight-kg', () => DEFAULT_WEIGHT_KG)
  const wkg = useState<number>('rider-wkg', () => DEFAULT_WKG)
  const ftpWatts = useState<number>('rider-ftp-watts', () => DEFAULT_FTP_WATTS)
  const defaultUnownedLevel = useState<number>('rider-default-unowned-level', () => DEFAULT_UNOWNED_LEVEL)

  function persist() {
    if (!import.meta.client) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      weightKg: weightKg.value,
      wkg: wkg.value,
      ftpWatts: ftpWatts.value,
      defaultUnownedLevel: defaultUnownedLevel.value
    }))
  }

  function load() {
    if (!import.meta.client) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (typeof parsed.weightKg === 'number') weightKg.value = parsed.weightKg
      if (typeof parsed.wkg === 'number') wkg.value = parsed.wkg
      if (typeof parsed.ftpWatts === 'number') ftpWatts.value = parsed.ftpWatts
      if (typeof parsed.defaultUnownedLevel === 'number') defaultUnownedLevel.value = parsed.defaultUnownedLevel
    } catch {
      // ignore corrupted storage
    }
  }

  /** Sets rider weight and recomputes `wkg` from the stored FTP, since W/kg depends on weight. */
  function setWeightKg(value: number) {
    weightKg.value = value
    wkg.value = ftpWatts.value / value
    persist()
  }

  /** Directly overrides `wkg` (e.g. the route page's per-ride power slider) without touching the stored FTP. */
  function setWkg(value: number) {
    wkg.value = value
    persist()
  }

  /** Sets FTP and recomputes `wkg` from it and the stored weight. */
  function setFtpWatts(value: number) {
    ftpWatts.value = value
    wkg.value = value / weightKg.value
    persist()
  }

  /** Sets the assumed upgrade stage (0-5) used to score/estimate frames the rider doesn't own. */
  function setDefaultUnownedLevel(value: number) {
    defaultUnownedLevel.value = value
    persist()
  }

  return { weightKg, wkg, ftpWatts, defaultUnownedLevel, load, setWeightKg, setWkg, setFtpWatts, setDefaultUnownedLevel }
}
