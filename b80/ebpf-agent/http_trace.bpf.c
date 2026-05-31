#include <vmlinux.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_core_read.h>
#include <bpf/bpf_tracing.h>

#define MAX_DATA_SIZE 2048
#define TASK_COMM_LEN 16
#define PERF_BUF_SIZE 64

struct event {
    u32 pid;
    u32 tgid;
    char comm[TASK_COMM_LEN];
    u64 timestamp;
    u32 is_send;
    u32 data_len;
    char data[MAX_DATA_SIZE];
};

struct {
    __uint(type, BPF_MAP_TYPE_PERF_EVENT_ARRAY);
    __uint(key_size, sizeof(u32));
    __uint(value_size, sizeof(u32));
    __uint(max_entries, 1024);
} events SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __type(key, u64);
    __type(value, u64);
} start_times SEC(".maps");

static __always_inline void
process_tcp_data(void *ctx, struct msghdr *msg, size_t len, int is_send)
{
    struct event e = {};
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;
    u32 tgid = pid_tgid & 0xFFFFFFFF;
    u64 ts = bpf_ktime_get_ns();
    
    if (len == 0 || len > MAX_DATA_SIZE)
        return;

    e.pid = pid;
    e.tgid = tgid;
    e.timestamp = ts;
    e.is_send = is_send;
    e.data_len = len > MAX_DATA_SIZE ? MAX_DATA_SIZE : len;
    bpf_get_current_comm(&e.comm, sizeof(e.comm));

    struct iovec iov;
    bpf_probe_read_kernel(&iov, sizeof(iov), &msg->msg_iov[0]);
    void *buf = iov.iov_base;
    if (buf) {
        long ret = bpf_probe_read_user(e.data, e.data_len, buf);
        if (ret != 0) {
            __builtin_memset(e.data, 0, sizeof(e.data));
            e.data_len = 0;
        }
    }

    bpf_perf_event_output(ctx, &events, BPF_F_CURRENT_CPU, &e, sizeof(e));
}

SEC("fentry/tcp_sendmsg")
int BPF_PROG(tcp_sendmsg_entry, struct sock *sk, struct msghdr *msg, size_t size)
{
    process_tcp_data(ctx, msg, size, 1);
    return 0;
}

SEC("fentry/tcp_recvmsg")
int BPF_PROG(tcp_recvmsg_entry, struct sock *sk, struct msghdr *msg, size_t len, int flags)
{
    process_tcp_data(ctx, msg, len, 0);
    return 0;
}

char LICENSE[] SEC("license") = "GPL";
