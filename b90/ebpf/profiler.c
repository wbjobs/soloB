//go:build ignore

#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

#define TASK_COMM_LEN 16
#define MAX_STACK_DEPTH 128
#define SQL_BUF_SIZE 2048

char LICENSE[] SEC("license") = "Dual BSD/GPL";

struct event {
    u64 ts;
    u32 pid;
    u32 tid;
    char comm[TASK_COMM_LEN];
    u32 event_type;
    u64 duration_ns;
    u64 bytes;
    u64 address;
    int retval;
    char filename[256];
    u64 stack_id;
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 1 << 24);
} events SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 8192);
    __type(key, u64);
    __type(value, u64);
} io_start_times SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 8192);
    __type(key, u64);
    __type(value, u64);
} mem_alloc_times SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_STACK_TRACE);
    __uint(key_size, sizeof(u32));
    __uint(value_size, MAX_STACK_DEPTH * sizeof(u64));
    __uint(max_entries, 1024);
} stack_traces SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 8192);
    __type(key, u32);
    __type(value, u64);
} process_page_cache SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 8192);
    __type(key, u32);
    __type(value, u64);
} process_io_read SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 8192);
    __type(key, u32);
    __type(value, u64);
} process_io_write SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 8192);
    __type(key, u32);
    __type(value, u64);
} tcp_tx_bytes SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 8192);
    __type(key, u32);
    __type(value, u64);
} tcp_rx_bytes SEC(".maps");

static __always_inline void get_process_comm(char *comm) {
    struct task_struct *task = (struct task_struct *)bpf_get_current_task();
    BPF_CORE_READ_STR_INTO(comm, task, comm);
}

SEC("kprobe/vfs_read")
int BPF_KPROBE(kprobe_vfs_read, struct file *file, char *buf, size_t count) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;
    u64 ts = bpf_ktime_get_ns();
    
    bpf_map_update_elem(&io_start_times, &pid_tgid, &ts, BPF_ANY);
    return 0;
}

SEC("kretprobe/vfs_read")
int BPF_KRETPROBE(kretprobe_vfs_read, int ret) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;
    u64 *start_ts = bpf_map_lookup_elem(&io_start_times, &pid_tgid);
    
    if (start_ts && ret > 0) {
        u64 duration = bpf_ktime_get_ns() - *start_ts;
        
        struct event *e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
        if (e) {
            e->ts = bpf_ktime_get_ns();
            e->pid = pid;
            e->tid = (u32)pid_tgid;
            e->event_type = 1;
            e->duration_ns = duration;
            e->bytes = ret;
            e->retval = ret;
            get_process_comm(e->comm);
            e->stack_id = bpf_get_stackid(ctx, &stack_traces, BPF_F_USER_STACK);
            bpf_ringbuf_submit(e, 0);
        }
        
        u64 *bytes = bpf_map_lookup_elem(&process_io_read, &pid);
        u64 new_bytes = bytes ? *bytes + ret : ret;
        bpf_map_update_elem(&process_io_read, &pid, &new_bytes, BPF_ANY);
    }
    
    bpf_map_delete_elem(&io_start_times, &pid_tgid);
    return 0;
}

SEC("kprobe/vfs_write")
int BPF_KPROBE(kprobe_vfs_write, struct file *file, const char *buf, size_t count) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u64 ts = bpf_ktime_get_ns();
    
    bpf_map_update_elem(&io_start_times, &pid_tgid, &ts, BPF_ANY);
    return 0;
}

SEC("kretprobe/vfs_write")
int BPF_KRETPROBE(kretprobe_vfs_write, int ret) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;
    u64 *start_ts = bpf_map_lookup_elem(&io_start_times, &pid_tgid);
    
    if (start_ts && ret > 0) {
        u64 duration = bpf_ktime_get_ns() - *start_ts;
        
        struct event *e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
        if (e) {
            e->ts = bpf_ktime_get_ns();
            e->pid = pid;
            e->tid = (u32)pid_tgid;
            e->event_type = 2;
            e->duration_ns = duration;
            e->bytes = ret;
            e->retval = ret;
            get_process_comm(e->comm);
            bpf_ringbuf_submit(e, 0);
        }
        
        u64 *bytes = bpf_map_lookup_elem(&process_io_write, &pid);
        u64 new_bytes = bytes ? *bytes + ret : ret;
        bpf_map_update_elem(&process_io_write, &pid, &new_bytes, BPF_ANY);
    }
    
    bpf_map_delete_elem(&io_start_times, &pid_tgid);
    return 0;
}

SEC("kprobe/__kmalloc")
int BPF_KPROBE(kprobe_kmalloc, size_t size, gfp_t flags) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u64 ts = bpf_ktime_get_ns();
    
    bpf_map_update_elem(&mem_alloc_times, &pid_tgid, &ts, BPF_ANY);
    return 0;
}

SEC("kretprobe/__kmalloc")
int BPF_KRETPROBE(kretprobe_kmalloc, void *ret) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;
    u64 *start_ts = bpf_map_lookup_elem(&mem_alloc_times, &pid_tgid);
    
    if (start_ts && ret) {
        u64 duration = bpf_ktime_get_ns() - *start_ts;
        
        struct event *e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
        if (e) {
            e->ts = bpf_ktime_get_ns();
            e->pid = pid;
            e->tid = (u32)pid_tgid;
            e->event_type = 3;
            e->duration_ns = duration;
            e->address = (u64)ret;
            get_process_comm(e->comm);
            bpf_ringbuf_submit(e, 0);
        }
    }
    
    bpf_map_delete_elem(&mem_alloc_times, &pid_tgid);
    return 0;
}

SEC("kprobe/tcp_sendmsg")
int BPF_KPROBE(kprobe_tcp_sendmsg, struct sock *sk, struct msghdr *msg, size_t size) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;
    
    u64 *bytes = bpf_map_lookup_elem(&tcp_tx_bytes, &pid);
    u64 new_bytes = bytes ? *bytes + size : size;
    bpf_map_update_elem(&tcp_tx_bytes, &pid, &new_bytes, BPF_ANY);
    
    struct event *e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
    if (e) {
        e->ts = bpf_ktime_get_ns();
        e->pid = pid;
        e->tid = (u32)pid_tgid;
        e->event_type = 4;
        e->bytes = size;
        get_process_comm(e->comm);
        bpf_ringbuf_submit(e, 0);
    }
    
    return 0;
}

SEC("kprobe/tcp_recvmsg")
int BPF_KPROBE(kprobe_tcp_recvmsg, struct sock *sk, struct msghdr *msg, size_t size, int flags) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;
    
    u64 *bytes = bpf_map_lookup_elem(&tcp_rx_bytes, &pid);
    u64 new_bytes = bytes ? *bytes + size : size;
    bpf_map_update_elem(&tcp_rx_bytes, &pid, &new_bytes, BPF_ANY);
    
    struct event *e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
    if (e) {
        e->ts = bpf_ktime_get_ns();
        e->pid = pid;
        e->tid = (u32)pid_tgid;
        e->event_type = 5;
        e->bytes = size;
        get_process_comm(e->comm);
        bpf_ringbuf_submit(e, 0);
    }
    
    return 0;
}

SEC("kprobe/mutex_lock")
int BPF_KPROBE(kprobe_mutex_lock, struct mutex *lock) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u64 ts = bpf_ktime_get_ns();
    
    bpf_map_update_elem(&io_start_times, &pid_tgid, &ts, BPF_ANY);
    return 0;
}

SEC("kretprobe/mutex_lock")
int BPF_KRETPROBE(kretprobe_mutex_lock, int ret) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;
    u64 *start_ts = bpf_map_lookup_elem(&io_start_times, &pid_tgid);
    
    if (start_ts) {
        u64 duration = bpf_ktime_get_ns() - *start_ts;
        
        struct event *e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
        if (e) {
            e->ts = bpf_ktime_get_ns();
            e->pid = pid;
            e->tid = (u32)pid_tgid;
            e->event_type = 6;
            e->duration_ns = duration;
            get_process_comm(e->comm);
            bpf_ringbuf_submit(e, 0);
        }
    }
    
    bpf_map_delete_elem(&io_start_times, &pid_tgid);
    return 0;
}

SEC("kprobe/page_cache_ra_unbounded")
int BPF_KPROBE(kprobe_page_cache, struct file *filp, struct address_space *mapping,
                pgoff_t index, unsigned long req_count, int ra_pages) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;
    
    u64 *count = bpf_map_lookup_elem(&process_page_cache, &pid);
    u64 new_count = count ? *count + 1 : 1;
    bpf_map_update_elem(&process_page_cache, &pid, &new_count, BPF_ANY);
    
    return 0;
}
