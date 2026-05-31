package com.syscall.monitor;

import org.apache.flink.api.common.functions.AggregateFunction;
import org.apache.flink.streaming.api.windowing.windows.TimeWindow;
import org.apache.flink.util.Collector;
import org.apache.flink.api.common.functions.RichAggregateFunction;
import org.apache.flink.api.java.tuple.Tuple2;

public class SyscallAggregateFunction implements AggregateFunction<SyscallEvent, SyscallAccumulator, SyscallAggregation> {

    @Override
    public SyscallAccumulator createAccumulator() {
        return new SyscallAccumulator();
    }

    @Override
    public SyscallAccumulator add(SyscallEvent event, SyscallAccumulator accumulator) {
        if (accumulator.getTgid() == 0) {
            accumulator.setTgid(event.getTgid());
            accumulator.setSyscall(event.getSyscall());
        }
        accumulator.setCount(accumulator.getCount() + 1);
        return accumulator;
    }

    @Override
    public SyscallAggregation getResult(SyscallAccumulator accumulator) {
        long now = System.currentTimeMillis();
        return new SyscallAggregation(
                accumulator.getWindowStart(),
                accumulator.getWindowEnd(),
                accumulator.getTgid(),
                accumulator.getSyscall(),
                accumulator.getCount(),
                now
        );
    }

    @Override
    public SyscallAccumulator merge(SyscallAccumulator a, SyscallAccumulator b) {
        SyscallAccumulator merged = new SyscallAccumulator();
        merged.setTgid(a.getTgid());
        merged.setSyscall(a.getSyscall());
        merged.setCount(a.getCount() + b.getCount());
        merged.setWindowStart(Math.min(a.getWindowStart(), b.getWindowStart()));
        merged.setWindowEnd(Math.max(a.getWindowEnd(), b.getWindowEnd()));
        return merged;
    }
}

class SyscallAccumulator {
    private long tgid = 0;
    private String syscall = "";
    private long count = 0;
    private long windowStart = Long.MAX_VALUE;
    private long windowEnd = Long.MIN_VALUE;

    public long getTgid() { return tgid; }
    public void setTgid(long tgid) { this.tgid = tgid; }
    
    public String getSyscall() { return syscall; }
    public void setSyscall(String syscall) { this.syscall = syscall; }
    
    public long getCount() { return count; }
    public void setCount(long count) { this.count = count; }
    
    public long getWindowStart() { return windowStart; }
    public void setWindowStart(long windowStart) { this.windowStart = windowStart; }
    
    public long getWindowEnd() { return windowEnd; }
    public void setWindowEnd(long windowEnd) { this.windowEnd = windowEnd; }
}
