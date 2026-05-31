import { useEffect, useRef, useState } from 'react'
import { SyscallEvent } from '../types'

interface Props {
  events: SyscallEvent[]
  autoScroll: boolean
}

const SYSCALL_COLORS: Record<string, string> = {
  openat: '#3b82f6',
  read: '#10b981',
  write: '#f59e0b',
  connect: '#ef4444',
}

function formatArgs(event: SyscallEvent): string {
  const parts: string[] = []
  
  for (let i = 0; i < event.arg_count; i++) {
    const argString = event.arg_strings[i]
    if (argString && argString.length > 0) {
      parts.push(`"${argString}"`)
    } else {
      parts.push(`0x${event.args[i].toString(16)}`)
    }
  }
  
  return parts.join(', ')
}

function formatRetval(event: SyscallEvent): string {
  if (event.retval >= 0) {
    return `${event.retval} (0x${event.retval.toString(16)})`
  }
  return `-${Math.abs(event.retval)} (error)`
}

export function SyscallTable({ events, autoScroll }: Props) {
  const tableRef = useRef<HTMLDivElement>(null)
  const prevLength = useRef(0)

  useEffect(() => {
    if (autoScroll && tableRef.current && events.length > prevLength.current) {
      tableRef.current.scrollTop = 0
    }
    prevLength.current = events.length
  }, [events, autoScroll])

  if (events.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🔍</div>
        <p>Waiting for system calls...</p>
        <p className="empty-hint">Start nginx and generate some traffic</p>
      </div>
    )
  }

  return (
    <div className="table-container" ref={tableRef}>
      <table className="syscall-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>PID</th>
            <th>TID</th>
            <th>Comm</th>
            <th>Syscall</th>
            <th>Arguments</th>
            <th>Return</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, index) => (
            <tr key={`${event.timestamp}-${index}`} className="syscall-row">
              <td className="timestamp">{event.timestamp_str.split(' ')[1]}</td>
              <td className="pid">{event.pid}</td>
              <td className="tid">{event.tid}</td>
              <td className="comm">{event.comm}</td>
              <td className="syscall">
                <span 
                  className="syscall-badge"
                  style={{ backgroundColor: SYSCALL_COLORS[event.syscall_name] || '#6b7280' }}
                >
                  {event.syscall_name}
                </span>
              </td>
              <td className="args">{formatArgs(event)}</td>
              <td className={`retval ${event.retval >= 0 ? 'success' : 'error'}`}>
                {formatRetval(event)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
