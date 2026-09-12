import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export function ThreeBackdrop() {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(54, 1, 0.1, 100)
    camera.position.set(0, 2.3, 8)
    camera.lookAt(0, -0.8, 0)

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)

    const grid = new THREE.GridHelper(22, 24, 0x00f0ff, 0x10353b)
    grid.position.y = -2.2
    grid.material.transparent = true
    grid.material.opacity = 0.22
    scene.add(grid)

    const points = new Float32Array(360 * 3)
    for (let index = 0; index < 360; index += 1) {
      points[index * 3] = (Math.random() - 0.5) * 20
      points[index * 3 + 1] = (Math.random() - 0.5) * 10
      points[index * 3 + 2] = (Math.random() - 0.5) * 16
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(points, 3))
    const material = new THREE.PointsMaterial({
      color: 0x00f0ff,
      size: 0.022,
      transparent: true,
      opacity: 0.42,
    })
    const particles = new THREE.Points(geometry, material)
    scene.add(particles)

    const rings: THREE.Mesh[] = []
    for (let index = 0; index < 3; index += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.8 + index * 1.2, 0.008, 6, 120),
        new THREE.MeshBasicMaterial({
          color: index === 1 ? 0x00ff88 : 0x00f0ff,
          transparent: true,
          opacity: 0.14 - index * 0.025,
        }),
      )
      ring.rotation.x = Math.PI / 2.6
      ring.position.y = -1
      rings.push(ring)
      scene.add(ring)
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let animationFrame = 0

    const resize = () => {
      const width = mount.clientWidth
      const height = mount.clientHeight
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(mount)
    resize()

    const animate = (time: number) => {
      const speed = reduceMotion ? 0 : time * 0.000025
      particles.rotation.y = speed
      rings.forEach((ring, index) => {
        ring.rotation.z = speed * (index % 2 ? -2 : 2)
      })
      renderer.render(scene, camera)
      animationFrame = window.requestAnimationFrame(animate)
    }
    animationFrame = window.requestAnimationFrame(animate)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      observer.disconnect()
      geometry.dispose()
      material.dispose()
      rings.forEach((ring) => {
        ring.geometry.dispose()
        ;(ring.material as THREE.Material).dispose()
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return <div className="three-backdrop" ref={mountRef} aria-hidden="true" />
}
