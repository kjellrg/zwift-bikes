/**
 * Swipe an Overlay away (#239), in the direction that reverses its entrance:
 * the equipment drawer back out the edge it came from, the centred about,
 * garage, profile and report Overlays down.
 *
 * A touch-only drag handler rather than a component swap. `UDrawer`
 * (vaul-vue) offers drag-to-dismiss free, but adopting it would change the
 * grab handle, the corners and the backdrop - the presentation change this
 * ticket excludes - and a bottom drawer is wrong for the modals on desktop,
 * so the swap would have to be conditional on viewport width. This handler
 * leaves `UModal` and `USlideover` exactly as they are and naturally does
 * nothing on a desktop, where mouse-drag dismissal is not wanted.
 *
 * The handlers are spread into the Overlay's `content` prop, which Nuxt UI
 * binds to the dialog element itself - so a drag starting anywhere on the
 * panel counts, and `translate` on that same element is what follows the
 * finger.
 */

/** Which way the panel leaves: `'down'` for a centred Overlay, `'right'` for the drawer. */
export type SwipeDismissDirection = 'down' | 'right'

/**
 * The three numbers a dismissing drag is judged by are `vaul-vue`'s own - the
 * drag threshold, `closeThreshold` and the velocity threshold it flicks on
 * (`8`, `0.25` and `0.4` in `node_modules/vaul-vue/dist/index.js`). They are
 * borrowed rather than invented because `UDrawer` is the component this
 * handler was weighed against and rejected on presentation grounds alone (see
 * above): a rider who has dismissed one drawer elsewhere in the ecosystem
 * should not find this one needs a different push.
 */
/** How far the first few pixels have to go before the gesture is claimed. Below this a touch is a tap, or a scroll that has not declared itself yet. */
const AXIS_THRESHOLD_PX = 8
/** Past this share of the panel's own extent, the release dismisses. */
const DISMISS_FRACTION = 0.25
/** A flick dismisses well short of that distance, so the gesture does not demand a full sweep of the screen. 0.4 px/ms is 400 px/s: a deliberate throw, not the speed a finger reaches while reading. */
const FLICK_VELOCITY_PX_PER_MS = 0.4
/** A flick still has to be a movement. Three times the claim threshold, so the jitter that claimed the gesture can never be the whole of it - not vaul's, which has no equivalent, but the floor without which a fast twitch dismisses what the rider was reading. */
const FLICK_MIN_PX = 24
/** The snap back when a drag is released short of either threshold. Nuxt UI's own overlay transitions run 150-200ms, so this does not read as a different component. */
const SNAP_BACK_TRANSITION = 'transform 150ms ease-out'

export function useSwipeDismiss(direction: SwipeDismissDirection, dismiss: () => void) {
  /** The dialog element the drag is moving - the `content` prop's own element. */
  let panel: HTMLElement | undefined
  let startX = 0
  let startY = 0
  /** When the drag was claimed - not when the finger landed, so a rider who rests a finger and then flicks is still flicking. */
  let draggingSince = 0
  /** How far the panel has been dragged along the dismissal axis, never below zero: a panel does not follow a finger going the other way. */
  let offset = 0
  /** A single touch is down and the gesture is still ours to claim or abandon. */
  let tracking = false
  /** The gesture is ours: the panel follows the finger and the browser is not scrolling. */
  let dragging = false

  function reset() {
    tracking = false
    dragging = false
    offset = 0
    panel = undefined
  }

  /**
   * Whether something under the finger is already scrolled along the
   * dismissal axis. A modal body scrolled down is what the rider is dragging
   * when they pull down inside it; only a body sitting at its own start has
   * nothing left to give, which is the point the panel takes over.
   */
  function scrollableUnderFinger(target: EventTarget | null): boolean {
    let node = target instanceof Element ? target : null
    while (node) {
      if (direction === 'down' ? node.scrollTop > 0 : node.scrollLeft > 0) return true
      if (node === panel) return false
      node = node.parentElement
    }
    return false
  }

  function snapBack() {
    if (panel) {
      panel.style.transition = SNAP_BACK_TRANSITION
      panel.style.transform = ''
      panel.style.willChange = ''
    }
    reset()
  }

  return {
    onTouchstart(event: TouchEvent) {
      const touch = event.touches.length === 1 ? event.touches[0] : undefined
      if (!touch) {
        reset()
        return
      }
      // A finger that lands on a control is talking to the control, not to
      // the Overlay: a slider thumb to drag (`ProfileContent` has five), a
      // caret to place in a field, a select to pull open. Nuxt UI puts the
      // thumb's `role="slider"` on the element the finger actually holds.
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [role="slider"], [contenteditable]')) {
        reset()
        return
      }
      panel = event.currentTarget as HTMLElement
      startX = touch.clientX
      startY = touch.clientY
      tracking = true
      dragging = false
      offset = 0
    },

    onTouchmove(event: TouchEvent) {
      if (!tracking || !panel) return
      const touch = event.touches.length === 1 ? event.touches[0] : undefined
      if (!touch) {
        snapBack()
        return
      }
      const alongAxis = direction === 'down' ? touch.clientY - startY : touch.clientX - startX
      const acrossAxis = direction === 'down' ? touch.clientX - startX : touch.clientY - startY
      if (!dragging) {
        if (Math.abs(alongAxis) < AXIS_THRESHOLD_PX && Math.abs(acrossAxis) < AXIS_THRESHOLD_PX) return
        // Claimed once, or abandoned for good: a gesture that starts as a
        // scroll must not turn into a dismissal halfway through, which is
        // how a rider reading a long Overlay loses their place.
        if (alongAxis <= 0 || Math.abs(alongAxis) <= Math.abs(acrossAxis) || scrollableUnderFinger(event.target)) {
          tracking = false
          return
        }
        dragging = true
        draggingSince = performance.now()
        panel.style.transition = 'none'
        panel.style.willChange = 'transform'
      }
      offset = Math.max(0, alongAxis)
      // Held back from the browser only once the gesture is ours, so a scroll
      // that was never a dismissal still scrolls.
      event.preventDefault()
      panel.style.transform = direction === 'down' ? `translate3d(0, ${offset}px, 0)` : `translate3d(${offset}px, 0, 0)`
    },

    onTouchend() {
      if (!dragging || !panel) {
        reset()
        return
      }
      const extent = direction === 'down' ? panel.offsetHeight : panel.offsetWidth
      const elapsedMs = performance.now() - draggingSince
      const velocity = elapsedMs > 0 ? offset / elapsedMs : 0
      if (offset >= extent * DISMISS_FRACTION || (offset >= FLICK_MIN_PX && velocity >= FLICK_VELOCITY_PX_PER_MS)) {
        // The panel is left where the finger let go of it: it unmounts from
        // there, so the dismissal reads as one movement rather than a snap
        // back followed by an exit.
        reset()
        dismiss()
        return
      }
      snapBack()
    },

    onTouchcancel() {
      snapBack()
    }
  }
}
