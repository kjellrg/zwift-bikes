import type { DraftMode } from '../../shared/utils/physics/draft'
import { clampTttRiders, TTT_DEFAULT_RIDERS } from '#shared/utils/physics/draft'

const STORAGE_KEY = 'zwift-bikes:rider-profile'

const DEFAULT_WEIGHT_KG = 75
const DEFAULT_HEIGHT_CM = 183
const DEFAULT_FTP_WATTS = 225
const DEFAULT_WKG = DEFAULT_FTP_WATTS / DEFAULT_WEIGHT_KG
// `DEFAULT_UNOWNED_LEVEL` deliberately isn't defined here: the recommend
// endpoints and the MCP tools have to assume the same stage, so it lives in
// `shared/utils/classifyBikeFrame.ts` alongside the level semantics.

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
  // Draft mode (see `shared/utils/physics/draft.ts`): 'solo' is today's
  // behavior; 'ttt' treats the entered watts as the paceline's front rider.
  const draftMode = useState<DraftMode>('rider-draft-mode', () => 'solo')
  const tttRiders = useState<number>('rider-ttt-riders', () => TTT_DEFAULT_RIDERS)
  // Optional "avg W/kg on climbs over 3-4 min" (TTT only) - undefined means
  // the front watts apply everywhere, climbs included.
  const tttClimbWkg = useState<number | undefined>('rider-ttt-climb-wkg', () => undefined)

  function persist() {
    if (!import.meta.client) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      weightKg: weightKg.value,
      heightCm: heightCm.value,
      wkg: wkg.value,
      ftpWatts: ftpWatts.value,
      defaultUnownedLevel: defaultUnownedLevel.value,
      draftMode: draftMode.value,
      tttRiders: tttRiders.value,
      tttClimbWkg: tttClimbWkg.value
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
      if (parsed.draftMode === 'ttt' || parsed.draftMode === 'solo') draftMode.value = parsed.draftMode
      if (typeof parsed.tttRiders === 'number') tttRiders.value = clampTttRiders(parsed.tttRiders)
      if (typeof parsed.tttClimbWkg === 'number') tttClimbWkg.value = Math.min(8, Math.max(0.5, parsed.tttClimbWkg))
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

  function setDraftMode(value: DraftMode) {
    draftMode.value = value === 'ttt' ? 'ttt' : 'solo'
    persist()
  }

  function setTttRiders(value: number) {
    tttRiders.value = clampTttRiders(value)
    persist()
  }

  function setTttClimbWkg(value: number | undefined) {
    tttClimbWkg.value = typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(8, Math.max(0.5, value)) : undefined
    persist()
  }

  return {
    weightKg,
    heightCm,
    wkg,
    ftpWatts,
    defaultUnownedLevel,
    draftMode,
    tttRiders,
    tttClimbWkg,
    load,
    setWeightKg,
    setHeightCm,
    setWkg,
    setFtpWatts,
    setDefaultUnownedLevel,
    setDraftMode,
    setTttRiders,
    setTttClimbWkg
  }
}
