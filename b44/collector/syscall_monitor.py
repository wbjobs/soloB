#!/usr/bin/env python3
import argparse
import json
import signal
import sys
import time
from collections import defaultdict

from bcc import BPF
from kafka import KafkaProducer

BPF_PROGRAM = """
#include <uapi/linux/ptrace.h>
#include <uapi/linux/limits.h>
#include <linux/sched.h>

BPF_PERF_OUTPUT(events);

struct syscall_event {
    u32 pid;
    u32 tgid;
    u64 timestamp;
    char syscall[32];
    char arg1[128];
    char arg2[128];
    long ret;
    u8 is_exit;
};

TRACEPOINT_PROBE(syscalls, sys_enter_open) {
    u32 pid = bpf_get_current_pid_tgid();
    u32 tgid = pid >> 32;
    pid = pid & 0xffffffff;
    
    if (tgid != TARGET_PID) return 0;
    
    struct syscall_event event = {};
    event.pid = pid;
    event.tgid = tgid;
    event.timestamp = bpf_ktime_get_ns();
    bpf_probe_read(&event.syscall, sizeof(event.syscall), "open");
    bpf_probe_read_user_str(&event.arg1, sizeof(event.arg1), (void *)args->filename);
    event.is_exit = 0;
    
    events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_open) {
    u32 pid = bpf_get_current_pid_tgid();
    u32 tgid = pid >> 32;
    pid = pid & 0xffffffff;
    
    if (tgid != TARGET_PID) return 0;
    
    struct syscall_event event = {};
    event.pid = pid;
    event.tgid = tgid;
    event.timestamp = bpf_ktime_get_ns();
    bpf_probe_read(&event.syscall, sizeof(event.syscall), "open");
    event.ret = args->ret;
    event.is_exit = 1;
    
    events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_openat) {
    u32 pid = bpf_get_current_pid_tgid();
    u32 tgid = pid >> 32;
    pid = pid & 0xffffffff;
    
    if (tgid != TARGET_PID) return 0;
    
    struct syscall_event event = {};
    event.pid = pid;
    event.tgid = tgid;
    event.timestamp = bpf_ktime_get_ns();
    bpf_probe_read(&event.syscall, sizeof(event.syscall), "openat");
    bpf_probe_read_user_str(&event.arg1, sizeof(event.arg1), (void *)args->filename);
    event.is_exit = 0;
    
    events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_openat) {
    u32 pid = bpf_get_current_pid_tgid();
    u32 tgid = pid >> 32;
    pid = pid & 0xffffffff;
    
    if (tgid != TARGET_PID) return 0;
    
    struct syscall_event event = {};
    event.pid = pid;
    event.tgid = tgid;
    event.timestamp = bpf_ktime_get_ns();
    bpf_probe_read(&event.syscall, sizeof(event.syscall), "openat");
    event.ret = args->ret;
    event.is_exit = 1;
    
    events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_read) {
    u32 pid = bpf_get_current_pid_tgid();
    u32 tgid = pid >> 32;
    pid = pid & 0xffffffff;
    
    if (tgid != TARGET_PID) return 0;
    
    struct syscall_event event = {};
    event.pid = pid;
    event.tgid = tgid;
    event.timestamp = bpf_ktime_get_ns();
    bpf_probe_read(&event.syscall, sizeof(event.syscall), "read");
    bpf_probe_read(&event.arg1, sizeof(event.arg1), "fd=");
    char fd_str[16];
    bpf_snprintf(&fd_str, sizeof(fd_str), "%d", args->fd);
    bpf_probe_read(&event.arg1[3], sizeof(event.arg1)-3, &fd_str);
    event.is_exit = 0;
    
    events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_read) {
    u32 pid = bpf_get_current_pid_tgid();
    u32 tgid = pid >> 32;
    pid = pid & 0xffffffff;
    
    if (tgid != TARGET_PID) return 0;
    
    struct syscall_event event = {};
    event.pid = pid;
    event.tgid = tgid;
    event.timestamp = bpf_ktime_get_ns();
    bpf_probe_read(&event.syscall, sizeof(event.syscall), "read");
    event.ret = args->ret;
    event.is_exit = 1;
    
    events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_write) {
    u32 pid = bpf_get_current_pid_tgid();
    u32 tgid = pid >> 32;
    pid = pid & 0xffffffff;
    
    if (tgid != TARGET_PID) return 0;
    
    struct syscall_event event = {};
    event.pid = pid;
    event.tgid = tgid;
    event.timestamp = bpf_ktime_get_ns();
    bpf_probe_read(&event.syscall, sizeof(event.syscall), "write");
    event.is_exit = 0;
    
    events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_write) {
    u32 pid = bpf_get_current_pid_tgid();
    u32 tgid = pid >> 32;
    pid = pid & 0xffffffff;
    
    if (tgid != TARGET_PID) return 0;
    
    struct syscall_event event = {};
    event.pid = pid;
    event.tgid = tgid;
    event.timestamp = bpf_ktime_get_ns();
    bpf_probe_read(&event.syscall, sizeof(event.syscall), "write");
    event.ret = args->ret;
    event.is_exit = 1;
    
    events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_connect) {
    u32 pid = bpf_get_current_pid_tgid();
    u32 tgid = pid >> 32;
    pid = pid & 0xffffffff;
    
    if (tgid != TARGET_PID) return 0;
    
    struct syscall_event event = {};
    event.pid = pid;
    event.tgid = tgid;
    event.timestamp = bpf_ktime_get_ns();
    bpf_probe_read(&event.syscall, sizeof(event.syscall), "connect");
    event.is_exit = 0;
    
    events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_connect) {
    u32 pid = bpf_get_current_pid_tgid();
    u32 tgid = pid >> 32;
    pid = pid & 0xffffffff;
    
    if (tgid != TARGET_PID) return 0;
    
    struct syscall_event event = {};
    event.pid = pid;
    event.tgid = tgid;
    event.timestamp = bpf_ktime_get_ns();
    bpf_probe_read(&event.syscall, sizeof(event.syscall), "connect");
    event.ret = args->ret;
    event.is_exit = 1;
    
    events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_close) {
    u32 pid = bpf_get_current_pid_tgid();
    u32 tgid = pid >> 32;
    pid = pid & 0xffffffff;
    
    if (tgid != TARGET_PID) return 0;
    
    struct syscall_event event = {};
    event.pid = pid;
    event.tgid = tgid;
    event.timestamp = bpf_ktime_get_ns();
    bpf_probe_read(&event.syscall, sizeof(event.syscall), "close");
    event.is_exit = 0;
    
    events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_close) {
    u32 pid = bpf_get_current_pid_tgid();
    u32 tgid = pid >> 32;
    pid = pid & 0xffffffff;
    
    if (tgid != TARGET_PID) return 0;
    
    struct syscall_event event = {};
    event.pid = pid;
    event.tgid = tgid;
    event.timestamp = bpf_ktime_get_ns();
    bpf_probe_read(&event.syscall, sizeof(event.syscall), "close");
    event.ret = args->ret;
    event.is_exit = 1;
    
    events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class SyscallMonitor:
    def __init__(self, pid, kafka_brokers="localhost:9092", kafka_topic="syscalls", verbose=False):
        self.pid = pid
        self.kafka_brokers = kafka_brokers
        self.kafka_topic = kafka_topic
        self.verbose = verbose
        self.running = True
        self.stats = defaultdict(int)
        
        bpf_program = BPF_PROGRAM.replace("TARGET_PID", str(pid))
        self.bpf = BPF(text=bpf_program)
        
        self.producer = KafkaProducer(
            bootstrap_servers=[kafka_brokers],
            value_serializer=lambda v: json.dumps(v).encode('utf-8'),
            compression_type='gzip',
            batch_size=16384,
            linger_ms=10
        )
        
        self.bpf["events"].open_perf_buffer(self.handle_event)
        
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)
    
    def signal_handler(self, signum, frame):
        print("\nStopping...")
        self.running = False
    
    def handle_event(self, cpu, data, size):
        event = self.bpf["events"].event(data)
        
        event_data = {
            "pid": event.pid,
            "tgid": event.tgid,
            "timestamp": event.timestamp,
            "syscall": event.syscall.decode('utf-8', 'replace').strip('\x00'),
            "arg1": event.arg1.decode('utf-8', 'replace').strip('\x00'),
            "arg2": event.arg2.decode('utf-8', 'replace').strip('\x00'),
            "ret": event.ret,
            "is_exit": bool(event.is_exit),
            "is_enter": not bool(event.is_exit)
        }
        
        if not event.is_exit:
            self.stats[event_data["syscall"]] += 1
        
        try:
            self.producer.send(self.kafka_topic, value=event_data)
            if self.verbose:
                print(json.dumps(event_data))
        except Exception as e:
            print(f"Error sending to Kafka: {e}", file=sys.stderr)
    
    def print_stats(self):
        if self.stats:
            print("\n=== Summary Statistics ===")
            for syscall, count in sorted(self.stats.items(), key=lambda x: x[1], reverse=True):
                print(f"{syscall:10s}: {count}")
    
    def run(self):
        print(f"Monitoring PID {self.pid}... Press Ctrl+C to stop.")
        
        try:
            while self.running:
                try:
                    self.bpf.perf_buffer_poll(timeout=100)
                except KeyboardInterrupt:
                    break
        finally:
            self.print_stats()
            self.producer.flush()
            self.producer.close()


def main():
    parser = argparse.ArgumentParser(
        description="Monitor system calls of a process using eBPF and send to Kafka"
    )
    parser.add_argument("-p", "--pid", type=int, required=True,
                        help="Target process ID to monitor")
    parser.add_argument("-k", "--kafka-brokers", default="localhost:9092",
                        help="Kafka brokers (default: localhost:9092)")
    parser.add_argument("-t", "--kafka-topic", default="syscalls",
                        help="Kafka topic (default: syscalls)")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Print captured events to stdout")
    
    args = parser.parse_args()
    
    monitor = SyscallMonitor(
        pid=args.pid,
        kafka_brokers=args.kafka_brokers,
        kafka_topic=args.kafka_topic,
        verbose=args.verbose
    )
    
    monitor.run()


if __name__ == "__main__":
    main()
