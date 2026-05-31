package com.syscall.monitor;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SyscallAggregation {
    private long windowStart;
    private long windowEnd;
    private long tgid;
    private String syscall;
    private long count;
    private long timestamp;
    
    public String getId() {
        return tgid + "_" + windowStart + "_" + syscall;
    }
}
