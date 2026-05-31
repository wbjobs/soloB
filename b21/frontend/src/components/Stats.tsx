import { SyscallEvent } from '../types'

interface Props {
  events: SyscallEvent[]
}

export function Stats({ events }: Props) {
  const stats = events.reduce((acc, event) => {
    acc[event.syscall_name] = (acc[event.syscall_name] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="stats">
      <div className="stat-card">
        <div className="stat-value">{events.length}</div>
        <div className="stat-label">Total Events</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{stats.openat || 0}</div>
        <div className="stat-label">openat</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{stats.read || 0}</div>
        <div className="stat-label">read</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{stats.write || 0}</div>
        <div className="stat-label">write</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{stats.connect || 0}</div>
        <div className="stat-label">connect</div>
      </div>
    </div>
  )
}
