import React, { useState } from 'react'

const wallPresets = [
  { name: '白色', color: 0xf5f5f5, roughness: 0.8, metalness: 0.1 },
  { name: '米黄', color: 0xf5e6d3, roughness: 0.7, metalness: 0.1 },
  { name: '浅灰', color: 0xd3d3d3, roughness: 0.6, metalness: 0.2 },
  { name: '深灰', color: 0x696969, roughness: 0.5, metalness: 0.3 },
  { name: '暖粉', color: 0xffb6c1, roughness: 0.7, metalness: 0.1 },
  { name: '淡蓝', color: 0xb0e0e6, roughness: 0.7, metalness: 0.1 },
]

const floorPresets = [
  { name: '木质', color: 0x8b7355, roughness: 0.7, metalness: 0.1 },
  { name: '深木', color: 0x654321, roughness: 0.6, metalness: 0.1 },
  { name: '大理石', color: 0xdcdcdc, roughness: 0.3, metalness: 0.5 },
  { name: '地砖', color: 0xc0c0c0, roughness: 0.4, metalness: 0.3 },
  { name: '地毯', color: 0x8b4513, roughness: 0.9, metalness: 0.0 },
  { name: '深色地毯', color: 0x4a4a4a, roughness: 0.9, metalness: 0.0 },
]

export default function MaterialPalette({ onWallChange, onFloorChange }) {
  const [activeTab, setActiveTab] = useState('walls')

  const colorToHex = (color) => {
    return '#' + color.toString(16).padStart(6, '0')
  }

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>材质选择</h3>
      
      <div style={styles.tabs}>
        <button 
          style={activeTab === 'walls' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('walls')}
        >
          墙壁
        </button>
        <button 
          style={activeTab === 'floor' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('floor')}
        >
          地板
        </button>
      </div>

      <div style={styles.presetsGrid}>
        {activeTab === 'walls' ? (
          wallPresets.map((preset, index) => (
            <div
              key={`wall-${index}`}
              style={styles.presetItem}
              onClick={() => onWallChange(preset)}
            >
              <div 
                style={{
                  ...styles.colorSwatch,
                  backgroundColor: colorToHex(preset.color)
                }}
              />
              <span style={styles.presetName}>{preset.name}</span>
            </div>
          ))
        ) : (
          floorPresets.map((preset, index) => (
            <div
              key={`floor-${index}`}
              style={styles.presetItem}
              onClick={() => onFloorChange(preset)}
            >
              <div 
                style={{
                  ...styles.colorSwatch,
                  backgroundColor: colorToHex(preset.color)
                }}
              />
              <span style={styles.presetName}>{preset.name}</span>
            </div>
          ))
        )}
      </div>
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
  title: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
  },
  tabs: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px',
  },
  tab: {
    flex: 1,
    padding: '8px 12px',
    border: '1px solid #ddd',
    backgroundColor: '#f5f5f5',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    color: '#666',
    transition: 'all 0.2s',
  },
  tabActive: {
    flex: 1,
    padding: '8px 12px',
    border: '1px solid #007bff',
    backgroundColor: '#007bff',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    color: '#fff',
  },
  presetsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
  },
  presetItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '8px',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  colorSwatch: {
    width: '40px',
    height: '40px',
    borderRadius: '4px',
    border: '1px solid #ddd',
    marginBottom: '4px',
  },
  presetName: {
    fontSize: '11px',
    color: '#666',
    textAlign: 'center',
  },
}
