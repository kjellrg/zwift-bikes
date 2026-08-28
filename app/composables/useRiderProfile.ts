import type { DraftMode } from '../../shared/utils/physics/draft'
import { clampTttClimbWkg, clampTttRiders, TTT_DEFAULT_RIDERS } from '#shared/utils/physics/draft'
import { clampPowerW, clampSprintPowerW, DEFAULT_POWER_W, DEFAULT_SPRINT_POWER_W, storedPowerW } from '#shared/utils/riderBounds'

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
const DEFAULT_HEIGHT_CM = 175
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
  // Power is stored in absolute watts and stays put when weight changes -
  // the sliders show W/kg only as a derived readout. Sprint segments get
  // their own value: a sprint effort is a different physical quantity from
  // race-pace power, and cranking one must never drag the other along.
  const powerW = useState<number>('rider-power-w', () => DEFAULT_POWER_W)
  const sprintPowerW = useState<number>('rider-sprint-power-w', () => DEFAULT_SPRINT_POWER_W)
  // There is deliberately no separate "FTP" value: the profile page's slider
  // and the route/segment/event page sliders edit this same `powerW`, so the
  // number a rider sets in one place is the number every page ranks with. A
  // separate `ftpWatts` existed once and fed only the profile readout -
  // riders read that as "my FTP isn't being used", because it wasn't.
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
      powerW: powerW.value,
      sprintPowerW: sprintPowerW.value,
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
      // Clamped into the sliders' own ranges (well inside the API's bounds,
      // so a stored value can never produce a request the API refuses).
      // `storedPowerW` also migrates pre-watt payloads that stored `wkg`,
      // converting at the weight loaded just above - which is why weight is
      // read first.
      const migratedPowerW = storedPowerW(parsed, weightKg.value)
      if (migratedPowerW !== undefined) powerW.value = migratedPowerW
      if (typeof parsed.sprintPowerW === 'number') sprintPowerW.value = clampSprintPowerW(parsed.sprintPowerW)
      if (typeof parsed.defaultUnownedLevel === 'number') defaultUnownedLevel.value = clampUnownedLevel(parsed.defaultUnownedLevel)
      if (parsed.draftMode === 'ttt' || parsed.draftMode === 'race' || parsed.draftMode === 'solo') draftMode.value = parsed.draftMode
      if (typeof parsed.tttRiders === 'number') tttRiders.value = clampTttRiders(parsed.tttRiders)
      if (typeof parsed.tttClimbWkg === 'number') tttClimbWkg.value = clampTttClimbWkg(parsed.tttClimbWkg)
    } catch {
      // ignore corrupted storage
    }
  }

  function setWeightKg(value: number) {
    // Power is stored in watts, so it stays put by construction - a rider
    // who corrects their weight has not changed how many watts they can
    // push. Only the derived W/kg readouts move.
    weightKg.value = clampWeightKg(value)
    persist()
  }

  function setHeightCm(value: number) {
    heightCm.value = Math.min(220, Math.max(100, Math.round(value)))
    persist()
  }

  function setPowerW(value: number) {
    powerW.value = clampPowerW(value)
    persist()
  }

  function setSprintPowerW(value: number) {
    sprintPowerW.value = clampSprintPowerW(value)
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

  // Deliberately independent of `powerW`: the pages seed the control from the
  // rider's normal power the first time it is shown, but once a team climb
  // pace exists it is never dragged along by later power changes.
  function setTttClimbWkg(value: number | undefined) {
    tttClimbWkg.value = clampTttClimbWkg(value)
    persist()
  }

  return {
    weightKg,
    heightCm,
    powerW,
    sprintPowerW,
    defaultUnownedLevel,
    draftMode,
    tttRiders,
    tttClimbWkg,
    load,
    setWeightKg,
    setHeightCm,
    setPowerW,
    setSprintPowerW,
    setDefaultUnownedLevel,
    setDraftMode,
    setTttRiders,
    setTttClimbWkg
  }
}
