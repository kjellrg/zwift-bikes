/**
 * Zwift's upgrade ladder as a number: where a frame stands between stage 0
 * (as bought) and stage 5 (fully upgraded). Ten sites used to clamp a stage
 * with their own inline `Math.min(5, Math.max(0, ...))` - the API schemas,
 * the classifier, the garage, the profile, the MCP tools, the upgrade
 * sparkline - so a change to what a stage can be had ten places to reach.
 *
 * A leaf module with no imports of its own (the `riderBounds.ts` precedent),
 * so every layer can read it without dragging the classifier or its data
 * tables along.
 */

/**
 * The top of the ladder. This removes the magic number from the sites that
 * clamp to it; it does **not** make the system parametric. Six stages are
 * encoded structurally elsewhere - `flatGapSecByStage` / `climbGapSecByStage`
 * are six-element rows, `FRAME_UPGRADE_SCHEMES`' curves are five-element
 * tuples, and the generated physics table
 * (`shared/data/equipmentPhysics.generated.json`) has a row per whole stage.
 * Raising this constant would widen the clamps and `UPGRADE_STAGES` below,
 * and nothing else - the data would still stop at stage 5. The only result
 * is clamps that disagree with it.
 */
export const MAX_UPGRADE_STAGE = 5

/**
 * Every upgrade stage a frame can be at. Exported so the recommend endpoints
 * can walk the same six stages when simulating what upgrading is worth on a
 * particular route (`ComboScore.upgradeFinishTimesSec`) - one list, so a
 * seventh stage could never mean two different things.
 */
export const UPGRADE_STAGES: readonly number[] = Array.from({ length: MAX_UPGRADE_STAGE + 1 }, (_, stage) => stage)

/**
 * Holds a stage inside the ladder without snapping it to a whole stage.
 * Only `interpolateGap` wants this: a fractional stage is meaningful there,
 * feeding the curve and linear interpolation paths between two measured
 * endpoints. Everywhere a stage is stored, sent or reported, use
 * `toUpgradeStage` instead.
 *
 * Precondition: `value` is finite. Non-finite input is deliberately not
 * handled here - the callers that can receive it each reject it differently
 * and correctly for their layer (the API 400s, the garage drops the entry,
 * the MCP tools fall back to `DEFAULT_UNOWNED_LEVEL`), and folding a default
 * into the clamp would silently turn the API's 400 into a ranked answer.
 */
export function clampUpgradeStage(value: number): number {
  return Math.min(MAX_UPGRADE_STAGE, Math.max(0, value))
}

/**
 * The whole stage a number means: clamped into the ladder and rounded.
 * Zwift's stages are whole numbers, and whole stages are the entire domain
 * the measured data and the precomputed physics table cover, so anything
 * persisted, validated or reported goes through this rather than
 * `clampUpgradeStage`.
 *
 * Same finite-input precondition as `clampUpgradeStage`.
 */
export function toUpgradeStage(value: number): number {
  return clampUpgradeStage(Math.round(value))
}

/**
 * What upgrade stage to assume for a frame the rider hasn't put in their
 * garage. Lives here, next to the stage semantics it refers to, so that
 * every surface that has to pick a stage - `useRiderProfile`, the recommend
 * endpoints, the MCP tools - reads the same number.
 *
 * That matters more than it looks: frames upgrade along different per-stage
 * schemes, so the assumed stage changes the *ranking*, not just the times.
 * On Road to Sky a stage-0 assumption puts the Tarmac SL9 on top while a
 * stage-5 one puts the Aethos S-Works there, 74s apart - so two surfaces
 * disagreeing on this default answer the same question with different bikes.
 *
 * 5 (fully upgraded) rather than 0: it is what the site has always shown, and
 * an unowned frame is being considered as something to work towards, which
 * makes its end state the fair comparison against everything else.
 *
 * Keeps the old `LEVEL` word (CONTEXT.md's glossary prefers "stage") because
 * it names the `defaultUnownedLevel` query key and the MCP `upgradeLevel`
 * argument, which are a published contract.
 */
export const DEFAULT_UNOWNED_LEVEL = 5
