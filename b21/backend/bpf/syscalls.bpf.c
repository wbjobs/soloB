//go:build ignore

#include <vmlinux.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

#define MAX_ARGS 4
#define MAX_ARG_LEN 128
#define MAX_COMM_LEN 16

struct syscall_event {
    __u64 timestamp;
    __u32 pid;
    __u32 tid;
    char comm[MAX_COMM_LEN];
    __u32 syscall_num;
    char syscall_name[32];
    __s64 retval;
    __u64 args[MAX_ARGS];
    char arg_strings[MAX_ARGS][MAX_ARG_LEN];
    __u32 arg_count;
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} events SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 8192);
    __type(key, __u32);
    __type(value, struct syscall_event);
} syscall_start SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);
    __type(value, __u32);
} tracked_pids SEC(".maps");

static __always_inline int is_target_process(struct task_struct *task) {
    char comm[MAX_COMM_LEN];
    BPF_CORE_READ_STR_INTO(&comm, task, comm);
    
    if (comm[0] == 'n' && comm[1] == 'g' && comm[2] == 'i' && comm[3] == 'n' && comm[4] == 'x') {
        if (comm[5] == '\0' || comm[5] == ':' || comm[5] == ' ') {
            return 1;
        }
    }
    return 0;
}

static __always_inline void copy_string(const char *src, char *dst, size_t len) {
    for (size_t i = 0; i < len - 1; i++) {
        if (bpf_probe_read_user(&dst[i], 1, &src[i]) != 0) {
            dst[i] = '\0';
            return;
        }
        if (dst[i] == '\0') {
            return;
        }
    }
    dst[len - 1] = '\0';
}

SEC("tracepoint/raw_syscalls/sys_enter")
int syscall_enter(struct trace_event_raw_sys_enter *ctx) {
    struct task_struct *task = (struct task_struct *)bpf_get_current_task();
    
    if (!is_target_process(task)) {
        return 0;
    }
    
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u32 tid = bpf_get_current_pid_tgid();
    __u32 syscall_num = ctx->id;
    
    __u32 one = 1;
    bpf_map_update_elem(&tracked_pids, &pid, &one, BPF_ANY);
    
    struct syscall_event event = {};
    event.timestamp = bpf_ktime_get_ns();
    event.pid = pid;
    event.tid = tid;
    event.syscall_num = syscall_num;
    event.arg_count = 0;
    
    char comm[MAX_COMM_LEN];
    BPF_CORE_READ_STR_INTO(&comm, task, comm);
    __builtin_memcpy(event.comm, comm, MAX_COMM_LEN);
    
    switch (syscall_num) {
        case 257: 
            __builtin_memcpy(event.syscall_name, "openat", 7);
            event.args[0] = ctx->args[0];
            if (ctx->args[1]) {
                copy_string((const char *)ctx->args[1], event.arg_strings[1], MAX_ARG_LEN);
            }
            event.args[2] = ctx->args[2];
            event.args[3] = ctx->args[3];
            event.arg_count = 4;
            break;
        case 0: 
            __builtin_memcpy(event.syscall_name, "read", 5);
            event.args[0] = ctx->args[0];
            event.args[1] = ctx->args[1];
            event.args[2] = ctx->args[2];
            event.arg_count = 3;
            break;
        case 1: 
            __builtin_memcpy(event.syscall_name, "write", 6);
            event.args[0] = ctx->args[0];
            event.args[1] = ctx->args[1];
            event.args[2] = ctx->args[2];
            event.arg_count = 3;
            break;
        case 42: 
            __builtin_memcpy(event.syscall_name, "connect", 8);
            event.args[0] = ctx->args[0];
            event.args[1] = ctx->args[1];
            event.args[2] = ctx->args[2];
            event.arg_count = 3;
            break;
        default:
            return 0;
    }
    
    __u32 tid_key = tid;
    bpf_map_update_elem(&syscall_start, &tid_key, &event, BPF_ANY);
    
    return 0;
}

SEC("tracepoint/raw_syscalls/sys_exit")
int syscall_exit(struct trace_event_raw_sys_exit *ctx) {
    __u32 tid = bpf_get_current_pid_tgid();
    
    struct syscall_event *event = bpf_map_lookup_elem(&syscall_start, &tid);
    if (!event) {
        return 0;
    }
    
    event->retval = ctx->ret;
    
    struct syscall_event *output = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!output) {
        bpf_map_delete_elem(&syscall_start, &tid);
        return 0;
    }
    
    __builtin_memcpy(output, event, sizeof(*event));
    bpf_ringbuf_submit(output, 0);
    
    bpf_map_delete_elem(&syscall_start, &tid);
    
    return 0;
}

SEC("tracepoint/sched/sched_process_exit")
int sched_process_exit(struct trace_event_raw_sched_process_exit *ctx) {
    __u32 pid = ctx->pid;
    
    bpf_map_delete_elem(&tracked_pids, &pid);
    
    __u32 tid = bpf_get_current_pid_tgid();
    bpf_map_delete_elem(&syscall_start, &tid);
    
    return 0;
}

char _license[] SEC("license") = "GPL";
