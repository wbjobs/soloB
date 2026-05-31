export interface SyscallEvent {
  timestamp: number
  timestamp_str: string
  pid: number
  tid: number
  comm: string
  syscall_num: number
  syscall_name: string
  retval: number
  args: number[]
  arg_strings: string[]
  arg_count: number
}
