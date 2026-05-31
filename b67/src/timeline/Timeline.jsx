import React, { useState, useRef, useEffect, useCallback } from 'react'
import './Timeline.css'

const formatTimeDisplay = (seconds) => {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${mins}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`
}

const Timeline = ({
  duration,
  startTime,
  endTime,
  currentTime,
  onTrimChange,
  onSeek,
  disabled = false
}) => {
  const timelineRef = useRef(null)
  const [dragHandle, setDragHandle] = useState(null)
  const [isDragging, setIsDragging] = useState(false)

  const pixelsPerSecond = useRef(0)

  useEffect(() => {
    if (timelineRef.current && duration > 0) {
      pixelsPerSecond.current = timelineRef.current.clientWidth / duration
    }
  }, [duration])

  const timeToPosition = useCallback((time) => {
    const width = timelineRef.current?.clientWidth || 0
    return duration > 0 ? (time / duration) * width : 0
  }, [duration])

  const positionToTime = useCallback((position) => {
    const width = timelineRef.current?.clientWidth || 0
    return width > 0 ? (position / width) * duration : 0
  }, [duration])

  const getRelativePosition = (e) => {
    const rect = timelineRef.current.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    let position = clientX - rect.left
    position = Math.max(0, Math.min(position, rect.width))
    return position
  }

  const handleMouseDown = (handle, e) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    setDragHandle(handle)
    setIsDragging(true)
  }

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !dragHandle) return

    const position = getRelativePosition(e)
    const time = positionToTime(position)

    if (dragHandle === 'start') {
      const newStart = Math.min(time, endTime - 0.1)
      onTrimChange(Math.max(0, newStart), endTime)
    } else if (dragHandle === 'end') {
      const newEnd = Math.max(time, startTime + 0.1)
      onTrimChange(startTime, Math.min(duration, newEnd))
    } else if (dragHandle === 'playhead') {
      onSeek(time)
    }
  }, [isDragging, dragHandle, startTime, endTime, duration, onTrimChange, onSeek, positionToTime])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    setDragHandle(null)
  }, [])

  const handleTimelineClick = (e) => {
    if (disabled || isDragging) return
    const position = getRelativePosition(e)
    const time = positionToTime(position)
    onSeek(time)
  }

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('touchmove', handleMouseMove)
      window.addEventListener('touchend', handleMouseUp)
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('touchmove', handleMouseMove)
      window.removeEventListener('touchend', handleMouseUp)
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const startPos = timeToPosition(startTime)
  const endPos = timeToPosition(endTime)
  const playheadPos = timeToPosition(currentTime)

  return (
    <div className={`timeline-container ${disabled ? 'disabled' : ''}`}>
      <div className="timeline-time-markers">
        {duration > 0 && Array.from({ length: Math.floor(duration / 10) + 1 }).map((_, i) => {
          const time = i * 10
          const position = (time / duration) * 100
          return (
            <div
              key={i}
              className="time-marker"
              style={{ left: `${Math.min(position, 100)}%` }}
            >
              <span className="time-label">{formatTimeDisplay(time)}</span>
            </div>
          )
        })}
      </div>

      <div
        ref={timelineRef}
        className="timeline-track"
        onClick={handleTimelineClick}
      >
        <div className="timeline-background">
          <div
            className="trimmed-region"
            style={{
              left: `${startPos}px`,
              width: `${endPos - startPos}px`
            }}
          />
        </div>

        <div
          className="handle start-handle"
          style={{ left: `${startPos}px` }}
          onMouseDown={(e) => handleMouseDown('start', e)}
          onTouchStart={(e) => handleMouseDown('start', e)}
        >
          <div className="handle-visual">
            <div className="handle-line" />
            <div className="handle-line" />
            <div className="handle-line" />
          </div>
        </div>

        <div
          className="playhead"
          style={{ left: `${playheadPos}px` }}
          onMouseDown={(e) => handleMouseDown('playhead', e)}
          onTouchStart={(e) => handleMouseDown('playhead', e)}
        >
          <div className="playhead-line" />
          <div className="playhead-triangle" />
        </div>

        <div
          className="handle end-handle"
          style={{ left: `${endPos}px` }}
          onMouseDown={(e) => handleMouseDown('end', e)}
          onTouchStart={(e) => handleMouseDown('end', e)}
        >
          <div className="handle-visual">
            <div className="handle-line" />
            <div className="handle-line" />
            <div className="handle-line" />
          </div>
        </div>
      </div>

      <div className="timeline-info">
        <div className="time-info">
          <span className="label">当前:</span>
          <span className="value">{formatTimeDisplay(currentTime)}</span>
        </div>
        <div className="time-info">
          <span className="label">开始:</span>
          <span className="value">{formatTimeDisplay(startTime)}</span>
        </div>
        <div className="time-info">
          <span className="label">结束:</span>
          <span className="value">{formatTimeDisplay(endTime)}</span>
        </div>
        <div className="time-info">
          <span className="label">总时长:</span>
          <span className="value">{formatTimeDisplay(duration)}</span>
        </div>
      </div>
    </div>
  )
}

export default Timeline
