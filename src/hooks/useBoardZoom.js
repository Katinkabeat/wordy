import { useRef, useState, useEffect, useCallback } from 'react'

const MIN_SCALE = 1.0
const MAX_SCALE = 3.0
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30
const SNAP_THRESHOLD = 1.05 // snap to 1.0 if barely zoomed
const RESET_TRANSITION = 'transform 0.25s ease-out'

function dist(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

function midpoint(a, b) {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
}

export default function useBoardZoom(boardSize) {
  const containerRef = useRef(null)
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [transitioning, setTransitioning] = useState(false)

  // Mutable refs for gesture tracking (no re-renders during gestures)
  const gestureRef = useRef({
    isPinching: false,
    isPanning: false,
    startDist: 0,
    startScale: 1,
    startMid: { x: 0, y: 0 },
    startTx: 0,
    startTy: 0,
    lastX: 0,
    lastY: 0,
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
    suppressClick: false,
  })

  // Clamp translate so the board always covers the container viewport.
  // With transformOrigin '0 0': the board spans from tx to tx + boardSize*scale.
  // It must cover [0, boardSize], so: tx <= 0 and tx + boardSize*scale >= boardSize.
  const clampTranslate = useCallback((x, y, s) => {
    if (s <= 1) return { x: 0, y: 0 }
    const minT = boardSize - boardSize * s  // negative: max leftward/upward shift
    return {
      x: Math.max(minT, Math.min(0, x)),
      y: Math.max(minT, Math.min(0, y)),
    }
  }, [boardSize])

  const resetZoom = useCallback(() => {
    setTransitioning(true)
    setScale(1)
    setTx(0)
    setTy(0)
    setTimeout(() => setTransitioning(false), 260)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const g = gestureRef.current

    // ── Suppress click after double-tap reset ──
    function handleClick(e) {
      if (g.suppressClick) {
        e.stopPropagation()
        e.preventDefault()
        g.suppressClick = false
      }
    }

    function handleTouchStart(e) {
      if (e.touches.length === 2) {
        // Pinch start
        e.preventDefault()
        g.isPinching = true
        g.isPanning = false
        g.startDist = dist(e.touches[0], e.touches[1])
        g.startScale = scale
        g.startMid = midpoint(e.touches[0], e.touches[1])
        g.startTx = tx
        g.startTy = ty
      } else if (e.touches.length === 1 && scale > 1) {
        // Pan start (only when zoomed)
        g.isPanning = true
        g.isPinching = false
        g.lastX = e.touches[0].clientX
        g.lastY = e.touches[0].clientY
      }
    }

    function handleTouchMove(e) {
      if (g.isPinching && e.touches.length === 2) {
        e.preventDefault()
        const newDist = dist(e.touches[0], e.touches[1])
        const ratio = newDist / g.startDist
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, g.startScale * ratio))

        // Focal-point zoom: keep the pinch midpoint stationary on screen.
        // The board content point under the initial midpoint should stay
        // under the current midpoint as scale changes.
        const rect = el.getBoundingClientRect()

        // Initial midpoint in container coords
        const sx = g.startMid.x - rect.left
        const sy = g.startMid.y - rect.top

        // Content point under the initial midpoint:
        // contentX = (sx - startTx) / startScale
        const contentX = (sx - g.startTx) / g.startScale
        const contentY = (sy - g.startTy) / g.startScale

        // Current midpoint in container coords
        const mid = midpoint(e.touches[0], e.touches[1])
        const mx = mid.x - rect.left
        const my = mid.y - rect.top

        // New translate so that contentPoint maps to current midpoint:
        // mx = contentX * newScale + newTx  =>  newTx = mx - contentX * newScale
        const newTx = mx - contentX * newScale
        const newTy = my - contentY * newScale

        const clamped = clampTranslate(newTx, newTy, newScale)
        setScale(newScale)
        setTx(clamped.x)
        setTy(clamped.y)
      } else if (g.isPanning && e.touches.length === 1) {
        e.preventDefault()
        const dx = e.touches[0].clientX - g.lastX
        const dy = e.touches[0].clientY - g.lastY
        g.lastX = e.touches[0].clientX
        g.lastY = e.touches[0].clientY

        const newTx = tx + dx
        const newTy = ty + dy
        const clamped = clampTranslate(newTx, newTy, scale)
        setTx(clamped.x)
        setTy(clamped.y)
      }
    }

    function handleTouchEnd(e) {
      if (g.isPinching) {
        g.isPinching = false
        // Snap to 1.0 if barely zoomed
        if (scale < SNAP_THRESHOLD) {
          resetZoom()
        }
        return
      }

      g.isPanning = false

      // Double-tap detection (single finger only)
      if (e.changedTouches.length === 1) {
        const now = Date.now()
        const touch = e.changedTouches[0]
        const tapDt = now - g.lastTapTime
        const tapDx = Math.abs(touch.clientX - g.lastTapX)
        const tapDy = Math.abs(touch.clientY - g.lastTapY)

        if (tapDt < DOUBLE_TAP_MS && tapDx < DOUBLE_TAP_PX && tapDy < DOUBLE_TAP_PX) {
          // Double tap detected
          if (scale > 1) {
            // Reset zoom
            g.suppressClick = true
            resetZoom()
          }
          g.lastTapTime = 0 // prevent triple-tap
        } else {
          g.lastTapTime = now
          g.lastTapX = touch.clientX
          g.lastTapY = touch.clientY
        }
      }
    }

    // Safari-specific: prevent native gesture zoom inside container
    function handleGestureStart(e) {
      e.preventDefault()
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: false })
    el.addEventListener('touchmove', handleTouchMove, { passive: false })
    el.addEventListener('touchend', handleTouchEnd)
    el.addEventListener('click', handleClick, true) // capture phase
    el.addEventListener('gesturestart', handleGestureStart)

    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
      el.removeEventListener('click', handleClick, true)
      el.removeEventListener('gesturestart', handleGestureStart)
    }
  }, [scale, tx, ty, boardSize, clampTranslate, resetZoom])

  const boardStyle = {
    transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
    transformOrigin: '0 0',
    transition: transitioning ? RESET_TRANSITION : 'none',
    willChange: 'transform',
  }

  return {
    containerRef,
    boardStyle,
    isZoomed: scale > 1,
    resetZoom,
  }
}
