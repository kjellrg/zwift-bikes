const STORAGE_KEY = 'zwift-bikes:rider-profile'

const DEFAULT_WEIGHT_KG = 75
const DEFAULT_HEIGHT_CM = 183
const DEFAULT_FTP_WATTS = 225
const DEFAULT_WKG = DEFAULT_FTP_WATTS / DEFAULT_WEIGHT_KG
const DEFAULT_UNOWNED_LEVEL = 0

/**
 * Tracks rider dimensions and power used by the route physics model.
 * Persisted to localStorage only.
 */
export function useRiderProfile() {
  const weightKg = useState<number>('rider-weight-kg', () => DEFAULT_WEIGHT_KG)
  const heightCm = useState<number>('rider-height-cm', () => DEFAULT_HEIGHT_CM)
  const wkg = useState<number>('rider-wkg', () => DEFAULT_WKG)
  const ftpWatts = useState<number>('rider-ftp-watts', () => DEFAULT_FTP_WATTS)
  const defaultUnownedLevel = useState<number>('rider-default-unowned-level', () => DEFAULT_UNOWNED_LEVEL)

  function persist() {
    if (!import.meta.client) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      weightKg: weightKg.value,
      heightCm: heightCm.value,
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
      if (typeof parsed.heightCm === 'number') heightCm.value = Math.min(220, Math.max(100, parsed.heightCm))
      if (typeof parsed.wkg === 'number') wkg.value = parsed.wkg
      if (typeof parsed.ftpWatts === 'number') ftpWatts.value = parsed.ftpWatts
      if (typeof parsed.defaultUnownedLevel === 'number') defaultUnownedLevel.value = parsed.defaultUnownedLevel
    } catch {
      // ignore corrupted storage
    }
  }

  function setWeightKg(value: number) {
    weightKg.value = value
    wkg.value = ftpWatts.value / value
    persist()
  }

  function setHeightCm(value: number) {
    heightCm.value = Math.min(220, Math.max(100, Math.round(value)))
    persist()
  }

  function setWkg(value: number) {
    wkg.value = value
    persist()
  }

  function setFtpWatts(value: number) {
    ftpWatts.value = value
    wkg.value = value / weightKg.value
    persist()
  }

  function setDefaultUnownedLevel(value: number) {
    defaultUnownedLevel.value = value
    persist()
  }

  return {
    weightKg,
    heightCm,
    wkg,
    ftpWatts,
    defaultUnownedLevel,
    load,
    setWeightKg,
    setHeightCm,
    setWkg,
    setFtpWatts,
    setDefaultUnownedLevel
  }
}
