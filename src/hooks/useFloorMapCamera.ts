import {type PointerEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState} from 'react';

export type FloorMapTableBounds = {
  x: number
  y: number
  width: number
  height: number
}

const MIN_ZOOM = 0.35
const MAX_ZOOM = 2.8
const PAN_THRESHOLD = 7

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const pointerDistance = (
  a: { x: number; y: number },
  b: { x: number; y: number }
) => Math.hypot(a.x - b.x, a.y - b.y)

export const useFloorMapCamera = (
  viewportRef: RefObject<HTMLDivElement | null>,
  tables: FloorMapTableBounds[],
  resetKey?: string
) => {
  const [camera, setCamera] = useState({x: 0, y: 0, zoom: 1})
  const [grabbing, setGrabbing] = useState(false)
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const suppressClickRef = useRef(false)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const panRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)
  const pinchRef = useRef<{
    distance: number
    zoom: number
    midX: number
    midY: number
  } | null>(null)

  const worldSize = useMemo(() => {
    if (!tables.length) {
      return {width: 800, height: 600, minX: 0, minY: 0}
    }
    let maxX = 0
    let maxY = 0
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    for (const table of tables) {
      const x = Math.max(0, Number(table.x) || 0)
      const y = Math.max(0, Number(table.y) || 0)
      const width = Math.max(40, Number(table.width) || 50)
      const height = Math.max(40, Number(table.height) || 50)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + width)
      maxY = Math.max(maxY, y + height)
    }
    return {
      minX: Number.isFinite(minX) ? minX : 0,
      minY: Number.isFinite(minY) ? minY : 0,
      width: Math.max(400, maxX + 48),
      height: Math.max(300, maxY + 48),
    }
  }, [tables])

  const zoomAt = useCallback((nextZoom: number, clientX: number, clientY: number) => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const rect = viewport.getBoundingClientRect()
    const cx = clientX - rect.left
    const cy = clientY - rect.top
    const {x, y, zoom} = cameraRef.current
    const clamped = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
    const worldX = (cx - x) / zoom
    const worldY = (cy - y) / zoom
    setCamera({
      zoom: clamped,
      x: cx - worldX * clamped,
      y: cy - worldY * clamped,
    })
  }, [viewportRef])

  const fitToView = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const viewW = viewport.clientWidth
    const viewH = viewport.clientHeight
    if (viewW < 40 || viewH < 40) {
      return
    }
    const pad = 56
    const contentW = Math.max(1, worldSize.width - worldSize.minX)
    const contentH = Math.max(1, worldSize.height - worldSize.minY)
    const zoom = clamp(
      Math.min((viewW - pad) / contentW, (viewH - pad) / contentH),
      MIN_ZOOM,
      1.15
    )
    setCamera({
      zoom,
      x: (viewW - contentW * zoom) / 2 - worldSize.minX * zoom,
      y: (viewH - contentH * zoom) / 2 - worldSize.minY * zoom,
    })
  }, [viewportRef, worldSize])

  useEffect(() => {
    fitToView()
  }, [resetKey, worldSize.width, worldSize.height, worldSize.minX, worldSize.minY, fitToView])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const observer = new ResizeObserver(() => fitToView())
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [fitToView, viewportRef])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return
    }
    const target = event.target as HTMLElement
    if (target.closest('[data-floor-map-controls]')) {
      return
    }
    pointersRef.current.set(event.pointerId, {x: event.clientX, y: event.clientY})
    suppressClickRef.current = false

    if (pointersRef.current.size === 1) {
      panRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: cameraRef.current.x,
        originY: cameraRef.current.y,
        moved: false,
      }
      pinchRef.current = null
      return
    }

    if (pointersRef.current.size === 2) {
      const [a, b] = Array.from(pointersRef.current.values())
      pinchRef.current = {
        distance: pointerDistance(a, b),
        zoom: cameraRef.current.zoom,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      }
      panRef.current = null
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) {
      return
    }
    pointersRef.current.set(event.pointerId, {x: event.clientX, y: event.clientY})

    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [a, b] = Array.from(pointersRef.current.values())
      const distance = pointerDistance(a, b)
      if (pinchRef.current.distance > 0) {
        const nextZoom = pinchRef.current.zoom * (distance / pinchRef.current.distance)
        zoomAt(nextZoom, (a.x + b.x) / 2, (a.y + b.y) / 2)
        suppressClickRef.current = true
      }
      return
    }

    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) {
      return
    }
    const dx = event.clientX - pan.startX
    const dy = event.clientY - pan.startY
    if (!pan.moved && Math.hypot(dx, dy) < PAN_THRESHOLD) {
      return
    }
    pan.moved = true
    suppressClickRef.current = true
    setGrabbing(true)
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    setCamera((prev) => ({
      ...prev,
      x: pan.originX + dx,
      y: pan.originY + dy,
    }))
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (pointersRef.current.size < 2) {
      pinchRef.current = null
    }
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null
    }
    if (pointersRef.current.size === 0) {
      setGrabbing(false)
    }
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const onNativeWheel = (event: WheelEvent) => {
      event.preventDefault()
      const factor = event.deltaY > 0 ? 0.9 : 1.1
      zoomAt(cameraRef.current.zoom * factor, event.clientX, event.clientY)
    }
    viewport.addEventListener('wheel', onNativeWheel, {passive: false})
    return () => viewport.removeEventListener('wheel', onNativeWheel)
  }, [viewportRef, zoomAt])

  const zoomBy = (factor: number) => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const rect = viewport.getBoundingClientRect()
    zoomAt(cameraRef.current.zoom * factor, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  return {
    camera,
    worldSize,
    suppressClickRef,
    fitToView,
    zoomIn: () => zoomBy(1.15),
    zoomOut: () => zoomBy(0.87),
    onPointerDown,
    onPointerMove,
    onPointerUp,
    isPanning: grabbing,
  }
}
