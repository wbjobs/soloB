import React, { useState, useEffect } from 'react'

const presetLocations = [
  { name: '北京', latitude: 39.9042, longitude: 116.4074, timezone: 8 },
  { name: '上海', latitude: 31.2304, longitude: 121.4737, timezone: 8 },
  { name: '广州', latitude: 23.1291, longitude: 113.2644, timezone: 8 },
  { name: '深圳', latitude: 22.5431, longitude: 114.0579, timezone: 8 },
  { name: '成都', latitude: 30.5728, longitude: 104.0668, timezone: 8 },
  { name: '纽约', latitude: 40.7128, longitude: -74.0060, timezone: -5 },
  { name: '伦敦', latitude: 51.5074, longitude: -0.1278, timezone: 0 },
  { name: '东京', latitude: 35.6762, longitude: 139.6503, timezone: 9 },
]

const presetDates = [
  { name: '春分 (3/21)', month: 3, day: 21 },
  { name: '夏至 (6/21)', month: 6, day: 21 },
  { name: '秋分 (9/22)', month: 9, day: 22 },
  { name: '冬至 (12/21)', month: 12, day: 21 },
]

export default function SunlightAnalysis({ 
  onEnabledChange,
  onLocationChange,
  onDateChange,
  onTimeChange,
  sunInfo,
  enabled
}) {
  const [selectedLocation, setSelectedLocation] = useState(presetLocations[0])
  const [selectedDate, setSelectedDate] = useState({
    year: 2024,
    month: 6,
    day: 21
  })
  const [selectedTime, setSelectedTime] = useState({
    hour: 12,
    minute: 0
  })
  const [isPlaying, setIsPlaying] = useState(false)
  const [playSpeed, setPlaySpeed] = useState(1)

  useEffect(() => {
    let interval = null
    
    if (isPlaying) {
      interval = setInterval(() => {
        setSelectedTime(prev => {
          let newMinute = prev.minute + 5 * playSpeed
          let newHour = prev.hour
          
          if (newMinute >= 60) {
            newMinute = 0
            newHour++
          }
          
          if (newHour >= 24) {
            newHour = 0
          }
          
          return { hour: newHour, minute: newMinute }
        })
      }, 500)
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isPlaying, playSpeed])

  useEffect(() => {
    if (onTimeChange) {
      onTimeChange(selectedTime.hour, selectedTime.minute)
    }
  }, [selectedTime])

  useEffect(() => {
    if (onDateChange) {
      onDateChange(selectedDate.year, selectedDate.month, selectedDate.day)
    }
  }, [selectedDate])

  const handleLocationSelect = (location) => {
    setSelectedLocation(location)
    if (onLocationChange) {
      onLocationChange(location.latitude, location.longitude, location.timezone)
    }
  }

  const handlePresetDate = (preset) => {
    setSelectedDate(prev => ({
      ...prev,
      month: preset.month,
      day: preset.day
    }))
  }

  const formatTime = (hour, minute) => {
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
  }

  const getSunColor = () => {
    if (!sunInfo) return '#ccc'
    if (sunInfo.elevation <= 0) return '#1a1a2e'
    if (sunInfo.elevation < 10) return '#ff6633'
    if (sunInfo.elevation < 20) return '#ffaa55'
    if (sunInfo.elevation < 30) return '#ffcc88'
    return '#ffd700'
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>☀️ 日照分析</h3>
        <label style={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange && onEnabledChange(e.target.checked)}
            style={styles.checkbox}
          />
          <span>启用</span>
        </label>
      </div>

      {enabled && (
        <>
          {sunInfo && (
            <div style={styles.sunInfoCard}>
              <div style={styles.sunIconWrapper}>
                <div style={{
                  ...styles.sunIcon,
                  backgroundColor: getSunColor(),
                  boxShadow: `0 0 20px ${getSunColor()}`,
                  opacity: sunInfo.elevation > 0 ? 1 : 0.3
                }} />
              </div>
              <div style={styles.sunInfoText}>
                <div style={styles.sunStatus}>
                  {sunInfo.elevation > 0 ? '☀️ 白天' : '🌙 夜晚'}
                </div>
                <div style={styles.sunDetails}>
                  <div>高度角: {sunInfo.elevation.toFixed(1)}°</div>
                  <div>方位角: {sunInfo.azimuth.toFixed(1)}°</div>
                </div>
              </div>
            </div>
          )}

          <div style={styles.section}>
            <div style={styles.sectionTitle}>📍 地理位置</div>
            <div style={styles.locationGrid}>
              {presetLocations.slice(0, 8).map((loc) => (
                <button
                  key={loc.name}
                  style={{
                    ...styles.locationButton,
                    ...(selectedLocation.name === loc.name ? styles.locationButtonActive : {})
                  }}
                  onClick={() => handleLocationSelect(loc)}
                >
                  {loc.name}
                </button>
              ))}
            </div>
            <div style={styles.coordinates}>
              <span>纬度: {selectedLocation.latitude.toFixed(4)}°</span>
              <span>经度: {selectedLocation.longitude.toFixed(4)}°</span>
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>📅 日期</div>
            <div style={styles.datePresets}>
              {presetDates.map((preset) => (
                <button
                  key={preset.name}
                  style={{
                    ...styles.dateButton,
                    ...(selectedDate.month === preset.month && selectedDate.day === preset.day 
                      ? styles.dateButtonActive 
                      : {})
                  }}
                  onClick={() => handlePresetDate(preset)}
                >
                  {preset.name}
                </button>
              ))}
            </div>
            <div style={styles.dateInputRow}>
              <select
                value={selectedDate.year}
                onChange={(e) => setSelectedDate(prev => ({ ...prev, year: parseInt(e.target.value) }))}
                style={styles.select}
              >
                {[2023, 2024, 2025].map(year => (
                  <option key={year} value={year}>{year}年</option>
                ))}
              </select>
              <select
                value={selectedDate.month}
                onChange={(e) => setSelectedDate(prev => ({ ...prev, month: parseInt(e.target.value) }))}
                style={styles.select}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                  <option key={month} value={month}>{month}月</option>
                ))}
              </select>
              <select
                value={selectedDate.day}
                onChange={(e) => setSelectedDate(prev => ({ ...prev, day: parseInt(e.target.value) }))}
                style={styles.select}
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                  <option key={day} value={day}>{day}日</option>
                ))}
              </select>
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>⏰ 时间</div>
            <div style={styles.timeSlider}>
              <input
                type="range"
                min="0"
                max="23"
                value={selectedTime.hour}
                onChange={(e) => {
                  setSelectedTime(prev => ({
                    ...prev,
                    hour: parseInt(e.target.value)
                  }))
                }}
                style={styles.slider}
              />
              <div style={styles.timeDisplay}>
                {formatTime(selectedTime.hour, selectedTime.minute)}
              </div>
            </div>
            <div style={styles.timeControls}>
              <button
                style={styles.controlButton}
                onClick={() => setIsPlaying(!isPlaying)}
              >
                {isPlaying ? '⏸ 暂停' : '▶️ 播放'}
              </button>
              <select
                value={playSpeed}
                onChange={(e) => setPlaySpeed(parseFloat(e.target.value))}
                style={styles.select}
              >
                <option value="0.5">0.5x</option>
                <option value="1">1x</option>
                <option value="2">2x</option>
                <option value="5">5x</option>
              </select>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const styles = {
  container: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: '8px',
    padding: '16px',
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
    marginTop: '16px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  title: {
    margin: 0,
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
  },
  toggleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    color: '#666',
    cursor: 'pointer',
  },
  checkbox: {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
  },
  sunInfoCard: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '12px',
    gap: '12px',
  },
  sunIconWrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sunIcon: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    transition: 'all 0.3s',
  },
  sunInfoText: {
    flex: 1,
  },
  sunStatus: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
    marginBottom: '4px',
  },
  sunDetails: {
    fontSize: '12px',
    color: '#666',
    display: 'flex',
    gap: '12px',
  },
  section: {
    marginBottom: '16px',
  },
  sectionTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#555',
    marginBottom: '8px',
  },
  locationGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '6px',
    marginBottom: '8px',
  },
  locationButton: {
    padding: '6px 8px',
    fontSize: '11px',
    border: '1px solid #e0e0e0',
    borderRadius: '4px',
    backgroundColor: '#fff',
    cursor: 'pointer',
    transition: 'all 0.2s',
    color: '#666',
  },
  locationButtonActive: {
    backgroundColor: '#007bff',
    borderColor: '#007bff',
    color: '#fff',
  },
  coordinates: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: '#999',
  },
  datePresets: {
    display: 'flex',
    gap: '6px',
    marginBottom: '8px',
    flexWrap: 'wrap',
  },
  dateButton: {
    padding: '6px 10px',
    fontSize: '11px',
    border: '1px solid #e0e0e0',
    borderRadius: '4px',
    backgroundColor: '#fff',
    cursor: 'pointer',
    transition: 'all 0.2s',
    color: '#666',
    whiteSpace: 'nowrap',
  },
  dateButtonActive: {
    backgroundColor: '#007bff',
    borderColor: '#007bff',
    color: '#fff',
  },
  dateInputRow: {
    display: 'flex',
    gap: '6px',
  },
  select: {
    padding: '6px 8px',
    fontSize: '12px',
    border: '1px solid #e0e0e0',
    borderRadius: '4px',
    backgroundColor: '#fff',
    cursor: 'pointer',
    flex: 1,
  },
  timeSlider: {
    marginBottom: '8px',
  },
  slider: {
    width: '100%',
    height: '6px',
    cursor: 'pointer',
  },
  timeDisplay: {
    textAlign: 'center',
    fontSize: '18px',
    fontWeight: '600',
    color: '#333',
    marginTop: '4px',
  },
  timeControls: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  controlButton: {
    flex: 1,
    padding: '8px 12px',
    fontSize: '12px',
    border: '1px solid #007bff',
    borderRadius: '4px',
    backgroundColor: '#007bff',
    color: '#fff',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
}
