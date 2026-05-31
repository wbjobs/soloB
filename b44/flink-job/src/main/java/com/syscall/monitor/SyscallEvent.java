package com.syscall.monitor;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SyscallEvent {
    private long pid;
    private long tgid;
    private long timestamp;
    private String syscall;
    private String arg1;
    private String arg2;
    private long ret;
    private boolean isExit;
    private boolean isEnter;
}
