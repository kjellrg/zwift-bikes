import type { DraftMode } from '../../shared/utils/physics/draft'
import { clampTttClimbWkg, clampTttRiders, TTT_DEFAULT_RIDERS } from '#shared/utils/physics/draft'
import { clampRiderWkg } from '#shared/utils/riderBounds'

const STORAGE_KEY = 'zwift-bikes:rider-profile'

/** Upgrade stages run 0 (stock) to 5 (fully upgraded); the API rejects anything outside. */
const clampUnownedLevel = (value: number) => Math.min(5, Math.max(0, value))

const DEFAULT_WEIGHT_KG = 75
/**
 * Weight bounds, matching the sliders on the route/segment pages. Kept wide
 * enough to cover any realistic Zwift rider but not so wide that a stray digit
 * (7 kg, 750 kg) silently produces nonsense finish times.
 */
const MIN_WEIGHT_KG = 40
const MAX_WEIGHT_KG = 130
const clampWeightKg = (value: number) => Math.min(MAX_WEIGHT_KG, Math.max(MIN_WEIGHT_KG, Math.round(value)))
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
  // Draft mode (see `shared/utils/physics/draft.ts`): 'solo' is a lone rider;
  // 'ttt' reads the entered watts as each rider's own rotation average; 'race'
  // reads them as the rider's own race average in a typical mass-start bunch
  // and needs no sub-state of its own (one field-calibrated constant).
  const draftMode = useState<DraftMode>('rider-draft-mode', () => 'solo')
  const tttRiders = useState<number>('rider-ttt-riders', () => TTT_DEFAULT_RIDERS)
  // Optional "avg W/kg on climbs over 3-4 min" (TTT only) - undefined means
  // the rider's normal power applies everywhere, climbs included.
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
      if (typeof parsed.weightKg === 'number') weightKg.value = clampWeightKg(parsed.weightKg)
      if (typeof parsed.heightCm === 'number') heightCm.value = Math.min(220, Math.max(100, parsed.heightCm))
      // Clamped into the API's own bounds (the recommend endpoints 400 on an
      // out-of-range profile or upgrade stage), so a stored value from before
      // those bounds existed can never produce a request the API refuses.
      if (typeof parsed.wkg === 'number') wkg.value = clampRiderWkg(parsed.wkg)
      if (typeof parsed.ftpWatts === 'number') ftpWatts.value = parsed.ftpWatts
      if (typeof parsed.defaultUnownedLevel === 'number') defaultUnownedLevel.value = clampUnownedLevel(parsed.defaultUnownedLevel)
      if (parsed.draftMode === 'ttt' || parsed.draftMode === 'race' || parsed.draftMode === 'solo') draftMode.value = parsed.draftMode
      if (typeof parsed.tttRiders === 'number') tttRiders.value = clampTttRiders(parsed.tttRiders)
      if (typeof parsed.tttClimbWkg === 'number') tttClimbWkg.value = clampTttClimbWkg(parsed.tttClimbWkg)
    } catch {
      // ignore corrupted storage
    }
  }

  function setWeightKg(value: number) {
    weightKg.value = clampWeightKg(value)
    // FTP is the fixed quantity here - a rider who corrects their weight has
    // not changed how many watts they can push, so W/kg is what moves.
    wkg.value = clampRiderWkg(ftpWatts.value / weightKg.value)
    persist()
  }

  function setHeightCm(value: number) {
    heightCm.value = Math.min(220, Math.max(100, Math.round(value)))
    persist()
  }

  function setWkg(value: number) {
    wkg.value = clampRiderWkg(value)
    persist()
  }

  function setFtpWatts(value: number) {
    ftpWatts.value = value
    wkg.value = clampRiderWkg(value / weightKg.value)
    persist()
  }

  function setDefaultUnownedLevel(value: number) {
    defaultUnownedLevel.value = clampUnownedLevel(value)
    persist()
  }

  function setDraftMode(value: DraftMode) {
    draftMode.value = value === 'ttt' || value === 'race' ? value : 'solo'
    persist()
  }

  function setTttRiders(value: number) {
    tttRiders.value = clampTttRiders(value)
    persist()
  }

  // Deliberately independent of `wkg`: the pages seed the control from the
  // rider's normal power the first time it is shown, but once a team climb
  // pace exists it is never dragged along by later power changes.
  function setTttClimbWkg(value: number | undefined) {
    tttClimbWkg.value = clampTttClimbWkg(value)
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
