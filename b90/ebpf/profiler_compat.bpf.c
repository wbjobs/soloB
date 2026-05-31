/*
 * eBPF Profiler with Kernel Compatibility
 * 
 * Supports:
 * - kprobe (kernel >= 5.4)
 * - tracepoint fallback (kernel >= 4.15)
 * - CO-RE with BTF relocations
 * - Automatic feature degradation
 */

#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>
#include "kernel_compat.h"

#define TASK_COMM_LEN 16
#define MAX_STACK_DEPTH 64
#define SQL_BUF_SIZE 2048

/* Event types */
#define EVENT_IO_READ    1
#define EVENT_IO_WRITE   2
#define EVENT_MEM_ALLOC  3
#define EVENT_TCP_TX     4
#define EVENT_TCP_RX     5
#define EVENT_LOCK_WAIT  6
#define EVENT_TRACEPOINT 7

/* Event structure for ringbuf */
struct profiler_event {
    __u64 timestamp_ns;
    __u32 pid;
    __u32 tgid;
    char comm[TASK_COMM_LEN];
    __u32 event_type;
    __u64 duration_ns;
    __u64 bytes;
    __u64 address;
    __s32 retval;
    char filename[256];
    __u64 stack_id;
    __u32 kernel_version;
    __u32 probe_type; /* 0 = kprobe, 1 = tracepoint */
} __attribute__((packed));

/* Ring buffer for events */
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 1 << 24);
} events SEC(".maps");

/* Start times for latency calculation */
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 8192);
    __type(key, __u64);
    __type(value, __u64);
} start_times SEC(".maps");

/* Process metrics aggregation */
struct process_metrics {
    __u64 io_read_bytes;
    __u64 io_write_bytes;
    __u64 io_read_count;
    __u64 io_write_count;
    __u64 page_cache_hits;
    __u64 tcp_tx_bytes;
    __u64 tcp_rx_bytes;
    __u64 mem_alloc_bytes;
    __u64 lock_wait_time_ns;
    __u64 lock_count;
} __attribute__((packed));

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 4096);
    __type(key, __u32);
    __type(value, struct process_metrics);
} process_metrics_map SEC(".maps");

/* Stack trace map - conditionally enabled */
#if __has_builtin(__builtin_preserve_access_index)
struct {
    __uint(type, BPF_MAP_TYPE_STACK_TRACE);
    __uint(key_size, sizeof(__u32));
    __uint(value_size, MAX_STACK_DEPTH * sizeof(__u64));
    __uint(max_entries, 1024);
} stack_traces SEC(".maps");
#endif

/* Helper: Reserve and initialize event */
static __always_inline struct profiler_event *reserve_event(void) {
    struct profiler_event *e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
    if (e) {
        __builtin_memset(e, 0, sizeof(*e));
        e->timestamp_ns = bpf_ktime_get_ns();
        e->kernel_version = get_kernel_version();
    }
    return e;
}

/* Helper: Submit event */
static __always_inline void submit_event(struct profiler_event *e) {
    if (e) {
        bpf_ringbuf_submit(e, 0);
    }
}

/* Helper: Get current PID/TGID safely */
static __always_inline void get_pids(__u32 *pid, __u32 *tgid) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    *pid = (__u32)(pid_tgid >> 32);
    *tgid = (__u32)(pid_tgid & 0xFFFFFFFF);
}

/* Helper: Get process name safely */
static __always_inline void get_comm(char *buf, size_t size) {
    if (bpf_core_field_exists(((struct task_struct *)0)->comm)) {
        struct task_struct *task = (void *)bpf_get_current_task();
        if (task) {
            char *comm = BPF_CORE_READ(task, comm);
            if (comm) {
                bpf_probe_read_kernel_str(buf, size, comm);
                return;
            }
        }
    }
    /* Fallback */
    bpf_get_current_comm(buf, size);
}

/* ============================================
 * KPROBE IMPLEMENTATION (for newer kernels)
 * ============================================ */

SEC("kprobe/vfs_read")
int BPF_KPROBE(kprobe_vfs_read, struct file *file, char *buf, size_t count, loff_t *pos) {
    if (use_tracepoint_fallback()) {
        return 0; /* Skip kprobes if tracepoint mode is enabled */
    }

    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 ts = bpf_ktime_get_ns();
    bpf_map_update_elem(&start_times, &pid_tgid, &ts, BPF_ANY);
    return 0;
}

SEC("kretprobe/vfs_read")
int BPF_KRETPROBE(kretprobe_vfs_read, int ret) {
    if (use_tracepoint_fallback()) {
        return 0;
    }

    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 *start_ts = bpf_map_lookup_elem(&start_times, &pid_tgid);

    if (start_ts && ret > 0) {
        struct profiler_event *e = reserve_event();
        if (e) {
            e->event_type = EVENT_IO_READ;
            e->duration_ns = bpf_ktime_get_ns() - *start_ts;
            e->bytes = ret;
            e->retval = ret;
            e->probe_type = 0; /* kprobe */
            get_pids(&e->pid, &e->tgid);
            get_comm(e->comm, sizeof(e->comm));
            submit_event(e);
        }

        /* Update metrics */
        __u32 pid = (__u32)(pid_tgid >> 32);
        struct process_metrics *metrics = bpf_map_lookup_elem(&process_metrics_map, &pid);
        if (metrics) {
            __sync_fetch_and_add(&metrics->io_read_bytes, ret);
            __sync_fetch_and_add(&metrics->io_read_count, 1);
        } else {
            struct process_metrics new_metrics = {0};
            new_metrics.io_read_bytes = ret;
            new_metrics.io_read_count = 1;
            bpf_map_update_elem(&process_metrics_map, &pid, &new_metrics, BPF_ANY);
        }
    }

    bpf_map_delete_elem(&start_times, &pid_tgid);
    return 0;
}

SEC("kprobe/vfs_write")
int BPF_KPROBE(kprobe_vfs_write, struct file *file, const char *buf, size_t count, loff_t *pos) {
    if (use_tracepoint_fallback()) {
        return 0;
    }

    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 ts = bpf_ktime_get_ns();
    bpf_map_update_elem(&start_times, &pid_tgid, &ts, BPF_ANY);
    return 0;
}

SEC("kretprobe/vfs_write")
int BPF_KRETPROBE(kretprobe_vfs_write, int ret) {
    if (use_tracepoint_fallback()) {
        return 0;
    }

    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 *start_ts = bpf_map_lookup_elem(&start_times, &pid_tgid);

    if (start_ts && ret > 0) {
        struct profiler_event *e = reserve_event();
        if (e) {
            e->event_type = EVENT_IO_WRITE;
            e->duration_ns = bpf_ktime_get_ns() - *start_ts;
            e->bytes = ret;
            e->retval = ret;
            e->probe_type = 0;
            get_pids(&e->pid, &e->tgid);
            get_comm(e->comm, sizeof(e->comm));
            submit_event(e);
        }

        __u32 pid = (__u32)(pid_tgid >> 32);
        struct process_metrics *metrics = bpf_map_lookup_elem(&process_metrics_map, &pid);
        if (metrics) {
            __sync_fetch_and_add(&metrics->io_write_bytes, ret);
            __sync_fetch_and_add(&metrics->io_write_count, 1);
        }
    }

    bpf_map_delete_elem(&start_times, &pid_tgid);
    return 0;
}

/* ============================================
 * TRACEPOINT IMPLEMENTATION (for older kernels)
 * ============================================ */

/*
 * Tracepoint: sys_enter_read - available since 4.15
 * /sys/kernel/debug/tracing/events/syscalls/sys_enter_read
 */
SEC("tracepoint/syscalls/sys_enter_read")
int tracepoint_enter_read(struct bpf_raw_tracepoint_args *ctx) {
    if (!use_tracepoint_fallback()) {
        return 0;
    }

    /* args: fd, buf, count */
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 ts = bpf_ktime_get_ns();
    bpf_map_update_elem(&start_times, &pid_tgid, &ts, BPF_ANY);
    return 0;
}

SEC("tracepoint/syscalls/sys_exit_read")
int tracepoint_exit_read(struct bpf_raw_tracepoint_args *ctx) {
    if (!use_tracepoint_fallback()) {
        return 0;
    }

    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 *start_ts = bpf_map_lookup_elem(&start_times, &pid_tgid);

    if (start_ts) {
        long ret = ctx->args[0]; /* syscall return value */
        if (ret > 0) {
            struct profiler_event *e = reserve_event();
            if (e) {
                e->event_type = EVENT_IO_READ;
                e->duration_ns = bpf_ktime_get_ns() - *start_ts;
                e->bytes = ret;
                e->retval = ret;
                e->probe_type = 1; /* tracepoint */
                get_pids(&e->pid, &e->tgid);
                get_comm(e->comm, sizeof(e->comm));
                submit_event(e);
            }

            __u32 pid = (__u32)(pid_tgid >> 32);
            struct process_metrics *metrics = bpf_map_lookup_elem(&process_metrics_map, &pid);
            if (metrics) {
                __sync_fetch_and_add(&metrics->io_read_bytes, ret);
                __sync_fetch_and_add(&metrics->io_read_count, 1);
            }
        }
    }

    bpf_map_delete_elem(&start_times, &pid_tgid);
    return 0;
}

/*
 * Tracepoint: sys_enter_write - available since 4.15
 */
SEC("tracepoint/syscalls/sys_enter_write")
int tracepoint_enter_write(struct bpf_raw_tracepoint_args *ctx) {
    if (!use_tracepoint_fallback()) {
        return 0;
    }

    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 ts = bpf_ktime_get_ns();
    bpf_map_update_elem(&start_times, &pid_tgid, &ts, BPF_ANY);
    return 0;
}

SEC("tracepoint/syscalls/sys_exit_write")
int tracepoint_exit_write(struct bpf_raw_tracepoint_args *ctx) {
    if (!use_tracepoint_fallback()) {
        return 0;
    }

    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 *start_ts = bpf_map_lookup_elem(&start_times, &pid_tgid);

    if (start_ts) {
        long ret = ctx->args[0];
        if (ret > 0) {
            struct profiler_event *e = reserve_event();
            if (e) {
                e->event_type = EVENT_IO_WRITE;
                e->duration_ns = bpf_ktime_get_ns() - *start_ts;
                e->bytes = ret;
                e->retval = ret;
                e->probe_type = 1;
                get_pids(&e->pid, &e->tgid);
                get_comm(e->comm, sizeof(e->comm));
                submit_event(e);
            }

            __u32 pid = (__u32)(pid_tgid >> 32);
            struct process_metrics *metrics = bpf_map_lookup_elem(&process_metrics_map, &pid);
            if (metrics) {
                __sync_fetch_and_add(&metrics->io_write_bytes, ret);
                __sync_fetch_and_add(&metrics->io_write_count, 1);
            }
        }
    }

    bpf_map_delete_elem(&start_times, &pid_tgid);
    return 0;
}

/*
 * Tracepoint: kmem - for memory allocation tracking
 * Available via tracepoints on most 4.x kernels
 */
SEC("tracepoint/kmem/kmalloc")
int tracepoint_kmalloc(struct bpf_raw_tracepoint_args *ctx) {
    if (!use_tracepoint_fallback()) {
        return 0;
    }

    __u32 pid, tgid;
    get_pids(&pid, &tgid);

    struct profiler_event *e = reserve_event();
    if (e) {
        e->event_type = EVENT_MEM_ALLOC;
        e->pid = pid;
        e->tgid = tgid;
        e->probe_type = 1;
        get_comm(e->comm, sizeof(e->comm));
        submit_event(e);
    }

    return 0;
}

/*
 * Tracepoint: tcp_sendmsg for network tracking
 */
SEC("tracepoint/tcp/tcp_sendmsg")
int tracepoint_tcp_sendmsg(struct bpf_raw_tracepoint_args *ctx) {
    if (!use_tracepoint_fallback()) {
        return 0;
    }

    /* Get size from tracepoint args (position varies by kernel) */
    __u32 pid, tgid;
    get_pids(&pid, &tgid);

    struct process_metrics *metrics = bpf_map_lookup_elem(&process_metrics_map, &pid);
    if (metrics) {
        __sync_fetch_and_add(&metrics->tcp_tx_bytes, 1); /* Count occurrences */
    }

    struct profiler_event *e = reserve_event();
    if (e) {
        e->event_type = EVENT_TCP_TX;
        e->pid = pid;
        e->tgid = tgid;
        e->probe_type = 1;
        get_comm(e->comm, sizeof(e->comm));
        submit_event(e);
    }

    return 0;
}

/* ============================================
 * COMPATIBILITY PROBE - for feature detection
 * ============================================ */

/*
 * Dummy probe to test eBPF loading
 * This gets loaded first to verify BPF functionality works
 */
SEC("kprobe/__x64_sys_getpid")
int BPF_KPROBE(compat_probe_getpid) {
    /* Simple verification that we can run */
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    return (__s32)(pid_tgid >> 32);
}

/*
 * Tracepoint version of compatibility probe
 */
SEC("tracepoint/syscalls/sys_enter_getpid")
int compat_tracepoint_getpid(struct bpf_raw_tracepoint_args *ctx) {
    return 0;
}

char LICENSE[] SEC("license") = "Dual BSD/GPL";

/*
 * Version marker - helps userspace identify BPF capabilities
 * Format: MAJOR << 16 | MINOR << 8 | PATCH
 */
__u32 _version SEC("version") = 0x010000; /* 1.0.0 */
