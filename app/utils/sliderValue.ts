/**
 * The number a `USlider` reports, as one value. Nuxt UI's slider emits a
 * `number` for one thumb, a `number[]` for a range, and `undefined` while it
 * has nothing to say - every slider in `RiderProfileControls` and
 * `ProfileContent` has one thumb, so the first entry is the value, and a
 * missing one keeps the number the control already shows rather than
 * blanking the label mid-drag.
 */
export function sliderValue(value: number | number[] | undefined, fallback: number): number {
  const single = Array.isArray(value) ? value[0] : value
  return single ?? fallback
}
