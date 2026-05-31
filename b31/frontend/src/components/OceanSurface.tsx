import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'

interface OceanSurfaceProps {
  heightData: number[]
  gridSize: number
}

const OceanSurface: React.FC<OceanSurfaceProps> = ({ heightData, gridSize }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const oceanMeshRef = useRef<THREE.Mesh | null>(null)
  const animationIdRef = useRef<number | null>(null)
  const mouseRef = useRef({ x: 0, y: 0, isDown: false, lastX: 0, lastY: 0 })
  const cameraRotationRef = useRef({ x: -0.6, y: 0 })
  const cameraDistanceRef = useRef(60)

  useEffect(() => {
    if (!containerRef.current) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x000d1a)
    scene.fog = new THREE.Fog(0x000d1a, 80, 150)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(
      60,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    )
    camera.position.set(0, 30, 50)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    containerRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const ambientLight = new THREE.AmbientLight(0x1a4a7a, 0.4)
    scene.add(ambientLight)

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.5)
    sunLight.position.set(50, 80, 30)
    scene.add(sunLight)

    const fillLight = new THREE.DirectionalLight(0x4488ff, 0.3)
    fillLight.position.set(-30, 20, -40)
    scene.add(fillLight)

    const geometry = new THREE.PlaneGeometry(80, 80, gridSize - 1, gridSize - 1)
    geometry.rotateX(-Math.PI / 2)

    const material = new THREE.MeshPhongMaterial({
      color: 0x0066aa,
      shininess: 80,
      specular: 0x3388cc,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide
    })

    const ocean = new THREE.Mesh(geometry, material)
    scene.add(ocean)
    oceanMeshRef.current = ocean

    const skyGeometry = new THREE.SphereGeometry(200, 32, 32)
    const skyMaterial = new THREE.MeshBasicMaterial({
      color: 0x001133,
      side: THREE.BackSide
    })
    const sky = new THREE.Mesh(skyGeometry, skyMaterial)
    scene.add(sky)

    const handleResize = () => {
      if (!containerRef.current || !camera || !renderer) return
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    }

    const handleMouseDown = (e: MouseEvent) => {
      mouseRef.current.isDown = true
      mouseRef.current.lastX = e.clientX
      mouseRef.current.lastY = e.clientY
    }

    const handleMouseUp = () => {
      mouseRef.current.isDown = false
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!mouseRef.current.isDown) return

      const deltaX = e.clientX - mouseRef.current.lastX
      const deltaY = e.clientY - mouseRef.current.lastY

      cameraRotationRef.current.y += deltaX * 0.005
      cameraRotationRef.current.x += deltaY * 0.005
      cameraRotationRef.current.x = Math.max(-Math.PI / 2 + 0.1, Math.min(0, cameraRotationRef.current.x))

      mouseRef.current.lastX = e.clientX
      mouseRef.current.lastY = e.clientY
    }

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      cameraDistanceRef.current += e.deltaY * 0.1
      cameraDistanceRef.current = Math.max(20, Math.min(120, cameraDistanceRef.current))
    }

    window.addEventListener('resize', handleResize)
    renderer.domElement.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('mousemove', handleMouseMove)
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false })

    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate)

      if (camera) {
        const r = cameraDistanceRef.current
        const theta = cameraRotationRef.current.y
        const phi = cameraRotationRef.current.x + Math.PI / 2

        camera.position.x = r * Math.sin(phi) * Math.cos(theta)
        camera.position.y = r * Math.cos(phi)
        camera.position.z = r * Math.sin(phi) * Math.sin(theta)
        camera.lookAt(0, 0, 0)
      }

      if (renderer && scene && camera) {
        renderer.render(scene, camera)
      }
    }

    animate()

    return () => {
      window.removeEventListener('resize', handleResize)
      renderer.domElement.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('mousemove', handleMouseMove)
      renderer.domElement.removeEventListener('wheel', handleWheel)

      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current)
      }

      if (renderer.domElement) {
        containerRef.current?.removeChild(renderer.domElement)
      }

      geometry.dispose()
      material.dispose()
      renderer.dispose()
    }
  }, [gridSize])

  useEffect(() => {
    if (!oceanMeshRef.current || heightData.length === 0) return

    const geometry = oceanMeshRef.current.geometry as THREE.PlaneGeometry
    const positions = geometry.attributes.position

    for (let i = 0; i < positions.count; i++) {
      const row = Math.floor(i / gridSize)
      const col = i % gridSize
      const dataIndex = (gridSize - 1 - row) * gridSize + col
      positions.setY(i, heightData[dataIndex] * 1.5)
    }

    positions.needsUpdate = true
    geometry.computeVertexNormals()
  }, [heightData, gridSize])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        cursor: 'grab'
      }}
    />
  )
}

export default OceanSurface
