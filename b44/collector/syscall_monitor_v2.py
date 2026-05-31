#!/usr/bin/env python3
import argparse
import atexit
import json
import logging
import os
import signal
import sys
import time
from collections import defaultdict
from queue import Queue, Empty

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

try:
    from bcc import BPF
except ImportError:
    logger.error("BCC module not found. Please install bcc tools.")
    logger.error("Ubuntu/Debian: sudo apt-get install bpfcc-tools python3-bcc")
    logger.error("CentOS/RHEL: sudo yum install bcc-tools python3-bcc")
    sys.exit(1)

try:
    from kafka import KafkaProducer
    from kafka.errors import KafkaError, NoBrokersAvailable
except ImportError:
    logger.error("kafka-python module not found.")
    logger.error("Install with: pip install kafka-python")
    sys.exit(1)


BPF_PROGRAM = """
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>
#include <linux/fs.h>

BPF_PERF_OUTPUT(events);

struct syscall_event {
    u32 pid;
    u32 tgid;
    u64 timestamp;
    u32 syscall_id;
    char syscall_name[32];
    char arg1_str[256];
    char arg2_str[256];
    char arg3_str[256];
    long ret;
    u8 is_exit;
    u64 arg1;
    u64 arg2;
    u64 arg3;
};

static __always_inline void submit_event(
    struct pt_regs *ctx, 
    u32 syscall_id, 
    const char *name, 
    const char *arg1_str,
    const char *arg2_str,
    const char *arg3_str,
    u64 arg1,
    u64 arg2,
    u64 arg3,
    long ret, 
    u8 is_exit
) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid;
    u32 tgid = pid_tgid >> 32;
    
    if (tgid != TARGET_PID) return;
    
    struct syscall_event event = {};
    event.pid = pid;
    event.tgid = tgid;
    event.timestamp = bpf_ktime_get_ns();
    event.syscall_id = syscall_id;
    event.ret = ret;
    event.is_exit = is_exit;
    event.arg1 = arg1;
    event.arg2 = arg2;
    event.arg3 = arg3;
    
    __builtin_memcpy(&event.syscall_name, name, sizeof(event.syscall_name));
    __builtin_memcpy(&event.arg1_str, arg1_str, sizeof(event.arg1_str));
    __builtin_memcpy(&event.arg2_str, arg2_str, sizeof(event.arg2_str));
    __builtin_memcpy(&event.arg3_str, arg3_str, sizeof(event.arg3_str));
    
    events.perf_submit(ctx, &event, sizeof(event));
}

TRACEPOINT_PROBE(syscalls, sys_enter_open) {
    char filename[256] = {};
    bpf_probe_read_user_str(&filename, sizeof(filename), (void *)args->filename);
    submit_event(args, 2, "open", filename, "", "", (u64)args->filename, (u64)args->flags, (u64)args->mode, 0, 0);
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_open) {
    submit_event(args, 2, "open", "", "", "", 0, 0, 0, args->ret, 1);
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_openat) {
    char filename[256] = {};
    bpf_probe_read_user_str(&filename, sizeof(filename), (void *)args->filename);
    submit_event(args, 257, "openat", filename, "", "", (u64)args->dfd, (u64)args->filename, (u64)args->flags, 0, 0);
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_openat) {
    submit_event(args, 257, "openat", "", "", "", 0, 0, 0, args->ret, 1);
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_read) {
    char fd_str[32];
    char count_str[32];
    bpf_snprintf(&fd_str, sizeof(fd_str), "fd=%d", args->fd);
    bpf_snprintf(&count_str, sizeof(count_str), "count=%ld", args->count);
    submit_event(args, 0, "read", fd_str, count_str, "", (u64)args->fd, (u64)args->buf, (u64)args->count, 0, 0);
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_read) {
    submit_event(args, 0, "read", "", "", "", 0, 0, 0, args->ret, 1);
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_write) {
    char fd_str[32];
    char count_str[32];
    bpf_snprintf(&fd_str, sizeof(fd_str), "fd=%d", args->fd);
    bpf_snprintf(&count_str, sizeof(count_str), "count=%ld", args->count);
    submit_event(args, 1, "write", fd_str, count_str, "", (u64)args->fd, (u64)args->buf, (u64)args->count, 0, 0);
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_write) {
    submit_event(args, 1, "write", "", "", "", 0, 0, 0, args->ret, 1);
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_connect) {
    char fd_str[32];
    bpf_snprintf(&fd_str, sizeof(fd_str), "fd=%d", args->fd);
    submit_event(args, 42, "connect", fd_str, "", "", (u64)args->fd, (u64)args->uservaddr, (u64)args->addrlen, 0, 0);
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_connect) {
    submit_event(args, 42, "connect", "", "", "", 0, 0, 0, args->ret, 1);
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_close) {
    char fd_str[32];
    bpf_snprintf(&fd_str, sizeof(fd_str), "fd=%d", args->fd);
    submit_event(args, 3, "close", fd_str, "", "", (u64)args->fd, 0, 0, 0, 0);
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_close) {
    submit_event(args, 3, "close", "", "", "", 0, 0, 0, args->ret, 1);
    return 0;
}
"""


class DualKafkaProducer:
    def __init__(self, brokers, agg_topic, detail_topic, max_queue_size=10000, retries=3):
        self.brokers = brokers
        self.agg_topic = agg_topic
        self.detail_topic = detail_topic
        self.max_queue_size = max_queue_size
        self.retries = retries
        self.agg_queue = Queue(maxsize=max_queue_size)
        self.detail_queue = Queue(maxsize=max_queue_size)
        self.producer = None
        self.connected = False
        self._initialize()
        
    def _initialize(self):
        logger.info(f"Connecting to Kafka brokers: {self.brokers}")
        attempts = 0
        max_attempts = 5
        
        while attempts < max_attempts and not self.connected:
            try:
                self.producer = KafkaProducer(
                    bootstrap_servers=self.brokers.split(','),
                    value_serializer=lambda v: json.dumps(v).encode('utf-8'),
                    compression_type='gzip',
                    batch_size=32768,
                    linger_ms=50,
                    max_block_ms=5000,
                    request_timeout_ms=30000,
                    retries=self.retries,
                    acks='1'
                )
                
                self.producer.bootstrap_connected()
                self.connected = True
                logger.info(f"Successfully connected to Kafka. Topics: {self.agg_topic}, {self.detail_topic}")
                
            except NoBrokersAvailable:
                attempts += 1
                wait_time = min(2 ** attempts, 10)
                logger.warning(f"Kafka brokers not available (attempt {attempts}/{max_attempts}). "
                             f"Retrying in {wait_time}s...")
                time.sleep(wait_time)
                
            except Exception as e:
                logger.error(f"Failed to initialize Kafka producer: {e}")
                break
        
        if not self.connected:
            logger.error("Could not connect to Kafka. Will queue messages for later delivery.")
    
    def _on_send_success(self, metadata):
        logger.debug(f"Message sent to {metadata.topic}:{metadata.partition}:{metadata.offset}")
    
    def _on_send_error(self, exception):
        logger.error(f"Message delivery failed: {exception}")
    
    def send_aggregated(self, message):
        if self.connected and self.producer:
            try:
                future = self.producer.send(self.agg_topic, value=message)
                future.add_callback(self._on_send_success)
                future.add_errback(self._on_send_error)
            except Exception as e:
                logger.debug(f"Failed to send agg message, queueing: {e}")
                self._queue_message(self.agg_queue, message)
        else:
            self._queue_message(self.agg_queue, message)
    
    def send_detail(self, message):
        if self.connected and self.producer:
            try:
                future = self.producer.send(self.detail_topic, value=message)
                future.add_callback(self._on_send_success)
                future.add_errback(self._on_send_error)
            except Exception as e:
                logger.debug(f"Failed to send detail message, queueing: {e}")
                self._queue_message(self.detail_queue, message)
        else:
            self._queue_message(self.detail_queue, message)
    
    def _queue_message(self, queue, message):
        try:
            queue.put_nowait(message)
        except:
            try:
                queue.get_nowait()
                queue.put_nowait(message)
            except:
                pass
    
    def flush_queue(self, queue, topic):
        if not self.connected:
            logger.info(f"Attempting to reconnect to flush queued messages...")
            self._initialize()
        
        if self.connected and self.producer:
            count = 0
            while not queue.empty():
                try:
                    message = queue.get_nowait()
                    self.producer.send(topic, value=message)
                    count += 1
                except Empty:
                    break
                except Exception as e:
                    logger.error(f"Error flushing message: {e}")
                    break
            
            if count > 0:
                logger.info(f"Flushed {count} queued messages to {topic}")
    
    def flush(self, timeout=10):
        if self.producer:
            try:
                self.flush_queue(self.agg_queue, self.agg_topic)
                self.flush_queue(self.detail_queue, self.detail_topic)
                self.producer.flush(timeout=timeout)
            except Exception as e:
                logger.error(f"Error during flush: {e}")
    
    def close(self):
        self.flush()
        if self.producer:
            try:
                self.producer.close(timeout=5)
                logger.info("Kafka producer closed")
            except Exception as e:
                logger.error(f"Error closing Kafka producer: {e}")


class EnhancedSyscallMonitor:
    def __init__(self, pid, kafka_brokers="localhost:9092", 
                 agg_topic="syscalls", detail_topic="syscalls-detail",
                 verbose=False, dry_run=False):
        self.pid = pid
        self.kafka_brokers = kafka_brokers
        self.agg_topic = agg_topic
        self.detail_topic = detail_topic
        self.verbose = verbose
        self.dry_run = dry_run
        self.running = True
        self.stats = defaultdict(int)
        self.event_count = 0
        self.bpf = None
        self.producer = None
        self.pending_enters = {}
        
        self._check_privileges()
        self._check_process_exists()
        self._initialize_bpf()
        
        if not dry_run:
            self.producer = DualKafkaProducer(
                brokers=kafka_brokers,
                agg_topic=agg_topic,
                detail_topic=detail_topic
            )
        
        atexit.register(self.cleanup)
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
    
    def _check_privileges(self):
        if os.geteuid() != 0:
            logger.error("This program requires root privileges to run eBPF.")
            logger.error("Please run with: sudo python3 syscall_monitor.py")
            sys.exit(1)
        logger.info("Root privileges verified")
    
    def _check_process_exists(self):
        try:
            os.kill(self.pid, 0)
            logger.info(f"Target process PID {self.pid} exists")
        except OSError:
            logger.error(f"Process with PID {self.pid} does not exist or is not accessible.")
            sys.exit(1)
    
    def _initialize_bpf(self):
        logger.info("Compiling and loading BPF program...")
        
        try:
            bpf_program = BPF_PROGRAM.replace("TARGET_PID", str(self.pid))
            self.bpf = BPF(text=bpf_program, cflags=["-Wno-macro-redefined"])
            logger.info("BPF program loaded successfully")
            
        except Exception as e:
            logger.error(f"Failed to load BPF program: {e}")
            logger.error("\nPossible reasons:")
            logger.error("1. Kernel does not support eBPF tracepoints (requires Linux 4.15+)")
            logger.error("2. Missing kernel headers")
            logger.error("\nTry installing kernel headers:")
            logger.error("  Ubuntu: sudo apt-get install linux-headers-$(uname -r)")
            logger.error("  CentOS: sudo yum install kernel-devel-$(uname -r)")
            sys.exit(1)
        
        try:
            self.bpf["events"].open_perf_buffer(
                self._handle_event,
                page_cnt=64
            )
            logger.info("Perf buffer opened successfully")
        except Exception as e:
            logger.error(f"Failed to open perf buffer: {e}")
            sys.exit(1)
    
    def _signal_handler(self, signum, frame):
        signame = signal.Signals(signum).name
        logger.info(f"Received {signame}, shutting down gracefully...")
        self.running = False
    
    def _handle_event(self, cpu, data, size):
        try:
            event = self.bpf["events"].event(data)
        except Exception as e:
            logger.warning(f"Error parsing event: {e}")
            return
        
        syscall_name = event.syscall_name.decode('utf-8', 'replace').rstrip('\x00')
        arg1_str = event.arg1_str.decode('utf-8', 'replace').rstrip('\x00')
        arg2_str = event.arg2_str.decode('utf-8', 'replace').rstrip('\x00')
        arg3_str = event.arg3_str.decode('utf-8', 'replace').rstrip('\x00')
        
        is_exit = bool(event.is_exit)
        
        event_key = f"{event.pid}_{syscall_name}"
        
        if not is_exit:
            self.stats[syscall_name] += 1
            self.pending_enters[event_key] = {
                'arg1': arg1_str,
                'arg2': arg2_str,
                'arg3': arg3_str,
                'timestamp': event.timestamp
            }
            
            agg_data = {
                "pid": event.pid,
                "tgid": event.tgid,
                "timestamp": event.timestamp,
                "syscall_id": event.syscall_id,
                "syscall": syscall_name,
                "ret": 0,
                "is_exit": False,
                "is_enter": True,
                "cpu": cpu
            }
            
            if not self.dry_run and self.producer:
                self.producer.send_aggregated(agg_data)
                
        else:
            enter_data = self.pending_enters.pop(event_key, {})
            
            detail_data = {
                "id": f"{event.tgid}_{event.timestamp}_{syscall_name}",
                "pid": event.pid,
                "tgid": event.tgid,
                "syscall": syscall_name,
                "syscall_id": event.syscall_id,
                "timestamp_ns": event.timestamp,
                "timestamp_ms": event.timestamp // 1_000_000,
                "timestamp_iso": datetime.fromtimestamp(event.timestamp / 1_000_000_000).isoformat() if event.timestamp > 0 else None,
                "arg1": enter_data.get('arg1', arg1_str),
                "arg2": enter_data.get('arg2', arg2_str),
                "arg3": enter_data.get('arg3', arg3_str),
                "ret": event.ret,
                "success": event.ret >= 0,
                "duration_ns": event.timestamp - enter_data.get('timestamp', event.timestamp) if 'timestamp' in enter_data else 0,
                "cpu": cpu
            }
            
            if not self.dry_run and self.producer:
                self.producer.send_detail(detail_data)
        
        self.event_count += 1
        
        if self.verbose:
            type_str = "EXIT" if is_exit else "ENTER"
            ret_str = f" ret={event.ret}" if is_exit else ""
            args_str = f" {arg1_str}" if arg1_str and not is_exit else ""
            print(f"[{type_str}] {syscall_name:8s}{args_str}{ret_str}")
        
        if self.event_count % 1000 == 0:
            logger.info(f"Captured {self.event_count} events so far...")
    
    def print_stats(self):
        if self.stats:
            print("\n" + "="*60)
            print("SYSTEM CALL STATISTICS")
            print("="*60)
            total = sum(self.stats.values())
            for syscall, count in sorted(self.stats.items(), key=lambda x: x[1], reverse=True):
                percentage = (count / total) * 100 if total > 0 else 0
                print(f"{syscall:10s}: {count:8d} ({percentage:5.1f}%)")
            print("="*60)
            print(f"Total syscalls captured: {total}")
            print("="*60)
        else:
            print("\nNo system calls were captured.")
            print("Make sure the target process is actively making system calls.")
    
    def cleanup(self):
        logger.info("Cleaning up...")
        
        if self.producer:
            self.producer.close()
        
        if self.bpf:
            try:
                self.bpf.cleanup()
                logger.info("BPF resources released")
            except Exception as e:
                logger.warning(f"Error during BPF cleanup: {e}")
        
        self.print_stats()
    
    def run(self):
        logger.info(f"Starting system call monitoring for PID {self.pid}")
        if self.dry_run:
            logger.info("DRY RUN MODE: Messages will not be sent to Kafka")
        logger.info("Press Ctrl+C to stop...\n")
        
        try:
            while self.running:
                try:
                    self.bpf.perf_buffer_poll(timeout=100)
                    
                    if self.producer and self.event_count % 100 == 0:
                        if self.producer.connected:
                            self.producer.flush_queue(self.producer.agg_queue, self.producer.agg_topic)
                            self.producer.flush_queue(self.producer.detail_queue, self.producer.detail_topic)
                        
                except KeyboardInterrupt:
                    break
                except Exception as e:
                    logger.warning(f"Error during perf buffer poll: {e}")
                    time.sleep(0.1)
                    
        finally:
            self.cleanup()


from datetime import datetime

def main():
    parser = argparse.ArgumentParser(
        description="Monitor system calls of a process using eBPF and send to Kafka",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Monitor process 12345 with default settings
  sudo python3 syscall_monitor_v2.py -p 12345
  
  # Monitor with verbose output and custom Kafka settings
  sudo python3 syscall_monitor_v2.py -p 12345 -v -k kafka:9092
  
  # Dry run (no Kafka, just print to console)
  sudo python3 syscall_monitor_v2.py -p 12345 --dry-run -v
        """
    )
    
    parser.add_argument("-p", "--pid", type=int, required=True,
                        help="Target process ID to monitor")
    parser.add_argument("-k", "--kafka-brokers", default="localhost:9092",
                        help="Kafka brokers (default: localhost:9092)")
    parser.add_argument("--agg-topic", default="syscalls",
                        help="Kafka topic for aggregated data (default: syscalls)")
    parser.add_argument("--detail-topic", default="syscalls-detail",
                        help="Kafka topic for detailed events (default: syscalls-detail)")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Print captured events to stdout")
    parser.add_argument("--dry-run", action="store_true",
                        help="Do not send to Kafka, just capture events")
    
    args = parser.parse_args()
    
    try:
        monitor = EnhancedSyscallMonitor(
            pid=args.pid,
            kafka_brokers=args.kafka_brokers,
            agg_topic=args.agg_topic,
            detail_topic=args.detail_topic,
            verbose=args.verbose,
            dry_run=args.dry_run
        )
        monitor.run()
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
