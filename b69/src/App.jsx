import React, { useEffect, useRef, useState } from 'react'
import Room from './3d/scene/Room.js'
import DragController from './3d/interaction/DragController.js'
import SSAO from './3d/postprocessing/SSAO.js'
import SunlightController from './3d/sunlight/SunlightController.js'
import MaterialPalette from './ui/src/MaterialPalette.jsx'
import SunlightAnalysis from './ui/src/SunlightAnalysis.jsx'

const furnitureLibrary = [
  { type: 'sofa', name: '沙发', icon: '🛋️' },
  { type: 'table', name: '餐桌', icon: '🪑' },
  { type: 'chair', name: '椅子', icon: '💺' },
  { type: 'cabinet', name: '柜子', icon: '🗄️' },
  { type: 'lamp', name: '灯具', icon: '💡' },
  { type: 'bed', name: '床', icon: '🛏️' },
]

export default function App() {
  const canvasContainerRef = useRef(null)
  const roomRef = useRef(null)
  const dragControllerRef = useRef(null)
  const ssaoRef = useRef(null)
  const sunlightRef = useRef(null)
  const [selectedFurniture, setSelectedFurniture] = useState(null)
  const [ssaoEnabled, setSsaoEnabled] = useState(true)
  const [furnitureCount, setFurnitureCount] = useState(0)
  const [sunlightEnabled, setSunlightEnabled] = useState(false)
  const [sunInfo, setSunInfo] = useState(null)

  useEffect(() => {
    if (canvasContainerRef.current && !roomRef.current) {
      roomRef.current = new Room(canvasContainerRef.current)
      dragControllerRef.current = new DragController(roomRef.current)
      sunlightRef.current = new SunlightController(roomRef.current)
      
      dragControllerRef.current.onSelect = (object) => {
        setSelectedFurniture(object.userData?.name || '选中物体')
      }
      
      dragControllerRef.current.onDeselect = () => {
        setSelectedFurniture(null)
      }

      sunlightRef.current.onSunPositionChange = (info) => {
        setSunInfo(info)
      }

      setSunInfo(sunlightRef.current.getSunInfo())
      setFurnitureCount(roomRef.current.getFurniture().length)
    }

    return () => {
      if (roomRef.current) {
        roomRef.current.dispose()
      }
      if (dragControllerRef.current) {
        dragControllerRef.current.dispose()
      }
      if (ssaoRef.current) {
        ssaoRef.current.dispose()
      }
      if (sunlightRef.current) {
        sunlightRef.current.dispose()
      }
    }
  }, [])

  const handleAddFurniture = (type) => {
    if (roomRef.current) {
      const x = (Math.random() - 0.5) * 10
      const z = (Math.random() - 0.5) * 10
      roomRef.current.addPlaceholderFurniture(type, { x, y: 0, z })
      setFurnitureCount(roomRef.current.getFurniture().length)
    }
  }

  const handleWallMaterialChange = (material) => {
    if (roomRef.current) {
      roomRef.current.updateWallMaterial(material)
    }
  }

  const handleFloorMaterialChange = (material) => {
    if (roomRef.current) {
      roomRef.current.updateFloorMaterial(material)
    }
  }

  const handleToggleSSAO = () => {
    const newState = !ssaoEnabled
    setSsaoEnabled(newState)
    if (ssaoRef.current) {
      ssaoRef.current.setEnabled(newState)
    }
  }

  const handleFileDrop = (e) => {
    e.preventDefault()
    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      const file = files[0]
      if (file.name.toLowerCase().endsWith('.glb') || file.name.toLowerCase().endsWith('.gltf')) {
        const url = URL.createObjectURL(file)
        if (roomRef.current) {
          roomRef.current.loadGLBModel(url, { x: 0, y: 0, z: 0 })
            .then(() => {
              setFurnitureCount(roomRef.current.getFurniture().length)
            })
            .catch((err) => {
              console.error('加载模型失败:', err)
              alert('模型加载失败，请确保文件格式正确')
            })
        }
      } else {
        alert('请拖拽 .glb 或 .gltf 格式的模型文件')
      }
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
  }

  const handleSunlightEnabledChange = (enabled) => {
    setSunlightEnabled(enabled)
    if (sunlightRef.current) {
      if (enabled) {
        sunlightRef.current.enable()
      } else {
        sunlightRef.current.disable()
      }
    }
  }

  const handleLocationChange = (latitude, longitude, timezone) => {
    if (sunlightRef.current) {
      sunlightRef.current.setLocation(latitude, longitude)
      sunlightRef.current.setTimezone(timezone)
    }
  }

  const handleDateChange = (year, month, day) => {
    if (sunlightRef.current) {
      const currentDate = sunlightRef.current.date
      sunlightRef.current.setDateTime(
        year,
        month,
        day,
        currentDate ? currentDate.getHours() : 12,
        currentDate ? currentDate.getMinutes() : 0
      )
    }
  }

  const handleTimeChange = (hour, minute) => {
    if (sunlightRef.current) {
      const currentDate = sunlightRef.current.date
      sunlightRef.current.setDateTime(
        currentDate ? currentDate.getFullYear() : 2024,
        currentDate ? currentDate.getMonth() + 1 : 6,
        currentDate ? currentDate.getDate() : 21,
        hour,
        minute
      )
    }
  }

  return (
    <div style={styles.app}>
      <div style={styles.header}>
        <h1 style={styles.title}>3D 室内设计预览工具</h1>
        <div style={styles.stats}>
          <span style={styles.stat}>家具数量: {furnitureCount}</span>
          {selectedFurniture && (
            <span style={styles.selectedInfo}>
              选中: {selectedFurniture}
            </span>
          )}
        </div>
      </div>

      <div style={styles.mainContent}>
        <div style={styles.sidebar}>
          <div style={styles.panel}>
            <h3 style={styles.panelTitle}>家具库</h3>
            <div style={styles.furnitureGrid}>
              {furnitureLibrary.map((item) => (
                <button
                  key={item.type}
                  style={styles.furnitureButton}
                  onClick={() => handleAddFurniture(item.type)}
                >
                  <span style={styles.furnitureIcon}>{item.icon}</span>
                  <span style={styles.furnitureName}>{item.name}</span>
                </button>
              ))}
            </div>
          </div>

          <SunlightAnalysis
            enabled={sunlightEnabled}
            onEnabledChange={handleSunlightEnabledChange}
            onLocationChange={handleLocationChange}
            onDateChange={handleDateChange}
            onTimeChange={handleTimeChange}
            sunInfo={sunInfo}
          />

          <MaterialPalette
            onWallChange={handleWallMaterialChange}
            onFloorChange={handleFloorMaterialChange}
          />

          <div style={styles.panel}>
            <h3 style={styles.panelTitle}>操作提示</h3>
            <ul style={styles.tipsList}>
              <li style={styles.tip}>🖱️ 鼠标左键拖动家具</li>
              <li style={styles.tip}>🔄 按 R 键旋转选中物体</li>
              <li style={styles.tip}>⬆️⬇️ 方向键微调位置</li>
              <li style={styles.tip}>🗑️ Delete/Backspace 删除</li>
              <li style={styles.tip}>📂 拖拽 .glb 文件到场景中</li>
            </ul>
          </div>

          <div style={styles.panel}>
            <h3 style={styles.panelTitle}>设置</h3>
            <label style={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={ssaoEnabled}
                onChange={handleToggleSSAO}
                style={styles.checkbox}
              />
              <span>启用后期效果 (Bloom)</span>
            </label>
          </div>
        </div>

        <div
          ref={canvasContainerRef}
          style={styles.canvasContainer}
          onDrop={handleFileDrop}
          onDragOver={handleDragOver}
        />
      </div>
    </div>
  )
}

const styles = {
  app: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    backgroundColor: '#1a1a2e',
  },
  header: {
    backgroundColor: '#16213e',
    padding: '12px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #0f3460',
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: '600',
    color: '#e0e0e0',
  },
  stats: {
    display: 'flex',
    gap: '24px',
    alignItems: 'center',
  },
  stat: {
    color: '#a0a0a0',
    fontSize: '14px',
  },
  selectedInfo: {
    color: '#00d9ff',
    fontSize: '14px',
    fontWeight: '500',
  },
  mainContent: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  sidebar: {
    width: '280px',
    backgroundColor: '#0f3460',
    padding: '16px',
    overflowY: 'auto',
    borderRight: '1px solid #16213e',
  },
  panel: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px',
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
  },
  panelTitle: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
  },
  furnitureGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '8px',
  },
  furnitureButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '12px 8px',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    backgroundColor: '#fff',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  furnitureIcon: {
    fontSize: '24px',
    marginBottom: '4px',
  },
  furnitureName: {
    fontSize: '12px',
    color: '#666',
  },
  tipsList: {
    margin: 0,
    paddingLeft: '16px',
  },
  tip: {
    fontSize: '12px',
    color: '#666',
    marginBottom: '6px',
    lineHeight: '1.5',
  },
  toggleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    color: '#333',
    cursor: 'pointer',
  },
  checkbox: {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
  },
  canvasContainer: {
    flex: 1,
    position: 'relative',
  },
}
