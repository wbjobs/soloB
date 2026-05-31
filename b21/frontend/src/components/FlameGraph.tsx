import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import * as d3FlameGraph from 'd3-flame-graph'
import 'd3-flame-graph/dist/d3-flamegraph.css'

interface FlameGraphNode {
  name: string
  value: number
  children?: FlameGraphNode[]
}

interface Props {
  refreshInterval?: number
}

const formatValue = (value: number) => {
  const ms = value / 1000000
  if (ms < 1) {
    return `${Math.round(value / 1000)} µs`
  }
  if (ms < 1000) {
    return `${ms.toFixed(2)} ms`
  }
  return `${(ms / 1000).toFixed(2)} s`
}

export function FlameGraph({ refreshInterval = 2000 }: Props) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const flameGraphRef = useRef<any>(null)
  const dataRef = useRef<FlameGraphNode | null>(null)

  const fetchData = async () => {
    try {
      const response = await fetch('/api/flamegraph')
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const data: FlameGraphNode = await response.json()
      dataRef.current = data
      return data
    } catch (err) {
      console.error('Failed to fetch flamegraph data:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
      throw err
    }
  }

  const renderFlameGraph = async () => {
    if (!chartRef.current) return

    try {
      setLoading(true)
      setError(null)

      const data = await fetchData()

      if (!flameGraphRef.current) {
        const width = chartRef.current.offsetWidth - 32
        const height = 400

        flameGraphRef.current = d3FlameGraph
          .flamegraph()
          .width(width)
          .height(height)
          .cellHeight(24)
          .transitionDuration(300)
          .transitionEase(d3.easeCubic)
          .minFrameSize(0.05)
          .sort(false)
          .title('System Call Flame Graph')
          .tooltip(true)
          .inverted(false)
          .tooltip((d: any) => {
            const percentage = ((d.data.value / data.value) * 100).toFixed(2)
            return `
              <div class="d3-flame-graph-tooltip">
                <strong>${d.data.name}</strong><br/>
                Time: ${formatValue(d.data.value)}<br/>
                Percentage: ${percentage}%
              </div>
            `
          })
          .label((d: any) => {
            const percentage = ((d.data.value / data.value) * 100).toFixed(1)
            return `${d.data.name} (${percentage}%)`
          })

        const svg = d3.select(chartRef.current)
          .append('svg')
          .attr('width', width)
          .attr('height', height)

        svg.datum(data).call(flameGraphRef.current)
      } else {
        d3.select(chartRef.current).selectAll('*').remove()
        
        const width = chartRef.current.offsetWidth - 32
        const height = 400

        flameGraphRef.current
          .width(width)
          .height(height)
          .tooltip((d: any) => {
            const percentage = ((d.data.value / data.value) * 100).toFixed(2)
            return `
              <div class="d3-flame-graph-tooltip">
                <strong>${d.data.name}</strong><br/>
                Time: ${formatValue(d.data.value)}<br/>
                Percentage: ${percentage}%
              </div>
            `
          })
          .label((d: any) => {
            const percentage = ((d.data.value / data.value) * 100).toFixed(1)
            return `${d.data.name} (${percentage}%)`
          })

        const svg = d3.select(chartRef.current)
          .append('svg')
          .attr('width', width)
          .attr('height', height)

        svg.datum(data).call(flameGraphRef.current)
      }

      setLoading(false)
    } catch (err) {
      console.error('Failed to render flame graph:', err)
      setLoading(false)
    }
  }

  useEffect(() => {
    renderFlameGraph()

    const interval = setInterval(renderFlameGraph, refreshInterval)

    return () => {
      clearInterval(interval)
    }
  }, [refreshInterval])

  if (error) {
    return (
      <div className="flame-graph-container">
        <h2 className="section-title">System Call Flame Graph</h2>
        <div className="error-state">
          <div className="error-icon">⚠️</div>
          <p>Failed to load flame graph</p>
          <p className="error-message">{error}</p>
          <button className="btn btn-retry" onClick={renderFlameGraph}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (loading && !dataRef.current) {
    return (
      <div className="flame-graph-container">
        <h2 className="section-title">System Call Flame Graph</h2>
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading flame graph...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flame-graph-container">
      <div className="flame-graph-header">
        <h2 className="section-title">System Call Flame Graph</h2>
        <div className="flame-graph-controls">
          <span className="refresh-indicator">Auto-refreshing every {refreshInterval / 1000}s</span>
          <button className="btn btn-refresh" onClick={renderFlameGraph}>
            🔄 Refresh
          </button>
        </div>
      </div>
      <div className="flame-graph-legend">
        <span className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#3b82f6' }}></span>
          openat
        </span>
        <span className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#10b981' }}></span>
          read
        </span>
        <span className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#f59e0b' }}></span>
          write
        </span>
        <span className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#ef4444' }}></span>
          connect
        </span>
      </div>
      <div className="flame-graph-chart" ref={chartRef}></div>
      <div className="flame-graph-info">
        <p>💡 Hover over boxes to see details. Click to zoom in, right-click to zoom out.</p>
      </div>
    </div>
  )
}
