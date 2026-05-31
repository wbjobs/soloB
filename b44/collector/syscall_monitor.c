#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <time.h>
#include <bcc/libbpf.h>
#include <bcc/bcc_common.h>
#include <bcc/bcc_syms.h>
#include <bcc/bcc_elf.h>
#include <librdkafka/rdkafka.h>

#define BPF_PROGRAM_OPEN \
    "BPF_PERF_OUTPUT(events);\n" \
    "struct syscall_data {\n" \
    "    u64 pid;\n" \
    "    u64 timestamp;\n" \
    "    char syscall[16];\n" \
    "    char arg1[128];\n" \
    "    char arg2[128];\n" \
    "    long ret;\n" \
    "};\n" \
    "int tracepoint__syscalls__sys_enter_open(struct tracepoint__syscalls__sys_enter_open *ctx) {\n" \
    "    u32 pid = bpf_get_current_pid_tgid() >> 32;\n" \
    "    if (pid != TARGET_PID) return 0;\n" \
    "    struct syscall_data data = {};\n" \
    "    data.pid = pid;\n" \
    "    data.timestamp = bpf_ktime_get_ns();\n" \
    "    __builtin_memcpy(&data.syscall, \"open\", 5);\n" \
    "    bpf_probe_read_user_str(&data.arg1, sizeof(data.arg1), (void *)ctx->filename);\n" \
    "    events.perf_submit(ctx, &data, sizeof(data));\n" \
    "    return 0;\n" \
    "}\n" \
    "int tracepoint__syscalls__sys_exit_open(struct tracepoint__syscalls__sys_exit_open *ctx) {\n" \
    "    u32 pid = bpf_get_current_pid_tgid() >> 32;\n" \
    "    if (pid != TARGET_PID) return 0;\n" \
    "    struct syscall_data data = {};\n" \
    "    data.pid = pid;\n" \
    "    data.timestamp = bpf_ktime_get_ns();\n" \
    "    __builtin_memcpy(&data.syscall, \"open_exit\", 10);\n" \
    "    data.ret = ctx->ret;\n" \
    "    events.perf_submit(ctx, &data, sizeof(data));\n" \
    "    return 0;\n" \
    "}\n" \
    "int tracepoint__syscalls__sys_enter_read(struct tracepoint__syscalls__sys_enter_read *ctx) {\n" \
    "    u32 pid = bpf_get_current_pid_tgid() >> 32;\n" \
    "    if (pid != TARGET_PID) return 0;\n" \
    "    struct syscall_data data = {};\n" \
    "    data.pid = pid;\n" \
    "    data.timestamp = bpf_ktime_get_ns();\n" \
    "    __builtin_memcpy(&data.syscall, \"read\", 5);\n" \
    "    snprintf(data.arg1, sizeof(data.arg1), \"fd=%d\", ctx->fd);\n" \
    "    snprintf(data.arg2, sizeof(data.arg2), \"count=%ld\", ctx->count);\n" \
    "    events.perf_submit(ctx, &data, sizeof(data));\n" \
    "    return 0;\n" \
    "}\n" \
    "int tracepoint__syscalls__sys_exit_read(struct tracepoint__syscalls__sys_exit_read *ctx) {\n" \
    "    u32 pid = bpf_get_current_pid_tgid() >> 32;\n" \
    "    if (pid != TARGET_PID) return 0;\n" \
    "    struct syscall_data data = {};\n" \
    "    data.pid = pid;\n" \
    "    data.timestamp = bpf_ktime_get_ns();\n" \
    "    __builtin_memcpy(&data.syscall, \"read_exit\", 10);\n" \
    "    data.ret = ctx->ret;\n" \
    "    events.perf_submit(ctx, &data, sizeof(data));\n" \
    "    return 0;\n" \
    "}\n" \
    "int tracepoint__syscalls__sys_enter_write(struct tracepoint__syscalls__sys_enter_write *ctx) {\n" \
    "    u32 pid = bpf_get_current_pid_tgid() >> 32;\n" \
    "    if (pid != TARGET_PID) return 0;\n" \
    "    struct syscall_data data = {};\n" \
    "    data.pid = pid;\n" \
    "    data.timestamp = bpf_ktime_get_ns();\n" \
    "    __builtin_memcpy(&data.syscall, \"write\", 6);\n" \
    "    snprintf(data.arg1, sizeof(data.arg1), \"fd=%d\", ctx->fd);\n" \
    "    snprintf(data.arg2, sizeof(data.arg2), \"count=%ld\", ctx->count);\n" \
    "    events.perf_submit(ctx, &data, sizeof(data));\n" \
    "    return 0;\n" \
    "}\n" \
    "int tracepoint__syscalls__sys_exit_write(struct tracepoint__syscalls__sys_exit_write *ctx) {\n" \
    "    u32 pid = bpf_get_current_pid_tgid() >> 32;\n" \
    "    if (pid != TARGET_PID) return 0;\n" \
    "    struct syscall_data data = {};\n" \
    "    data.pid = pid;\n" \
    "    data.timestamp = bpf_ktime_get_ns();\n" \
    "    __builtin_memcpy(&data.syscall, \"write_exit\", 11);\n" \
    "    data.ret = ctx->ret;\n" \
    "    events.perf_submit(ctx, &data, sizeof(data));\n" \
    "    return 0;\n" \
    "}\n" \
    "int tracepoint__syscalls__sys_enter_connect(struct tracepoint__syscalls__sys_enter_connect *ctx) {\n" \
    "    u32 pid = bpf_get_current_pid_tgid() >> 32;\n" \
    "    if (pid != TARGET_PID) return 0;\n" \
    "    struct syscall_data data = {};\n" \
    "    data.pid = pid;\n" \
    "    data.timestamp = bpf_ktime_get_ns();\n" \
    "    __builtin_memcpy(&data.syscall, \"connect\", 8);\n" \
    "    snprintf(data.arg1, sizeof(data.arg1), \"fd=%d\", ctx->fd);\n" \
    "    events.perf_submit(ctx, &data, sizeof(data));\n" \
    "    return 0;\n" \
    "}\n" \
    "int tracepoint__syscalls__sys_exit_connect(struct tracepoint__syscalls__sys_exit_connect *ctx) {\n" \
    "    u32 pid = bpf_get_current_pid_tgid() >> 32;\n" \
    "    if (pid != TARGET_PID) return 0;\n" \
    "    struct syscall_data data = {};\n" \
    "    data.pid = pid;\n" \
    "    data.timestamp = bpf_ktime_get_ns();\n" \
    "    __builtin_memcpy(&data.syscall, \"connect_exit\", 13);\n" \
    "    data.ret = ctx->ret;\n" \
    "    events.perf_submit(ctx, &data, sizeof(data));\n" \
    "    return 0;\n" \
    "}\n"

struct syscall_data {
    uint64_t pid;
    uint64_t timestamp;
    char syscall[16];
    char arg1[128];
    char arg2[128];
    long ret;
};

static volatile int running = 1;

void handle_sigint(int sig) {
    running = 0;
}

void print_usage(char *prog_name) {
    printf("Usage: %s -p <pid> [-k <kafka-brokers>] [-t <topic>]\n", prog_name);
    printf("Options:\n");
    printf("  -p <pid>          Target process ID to monitor (required)\n");
    printf("  -k <brokers>      Kafka brokers (default: localhost:9092)\n");
    printf("  -t <topic>        Kafka topic (default: syscalls)\n");
    printf("  -h                Show this help message\n");
}

void handle_event(void *ctx, void *data, size_t data_sz) {
    const struct syscall_data *event = data;
    rd_kafka_t *rk = (rd_kafka_t *)ctx;
    
    char json[512];
    int len = snprintf(json, sizeof(json),
        "{\"pid\":%llu,\"timestamp\":%llu,\"syscall\":\"%s\",\"arg1\":\"%s\",\"arg2\":\"%s\",\"ret\":%ld}",
        (unsigned long long)event->pid,
        (unsigned long long)event->timestamp,
        event->syscall,
        event->arg1,
        event->arg2,
        event->ret);
    
    rd_kafka_producev(
        rk,
        RD_KAFKA_V_TOPIC("syscalls"),
        RD_KAFKA_V_MSGFLAGS(RD_KAFKA_MSG_F_COPY),
        RD_KAFKA_V_VALUE(json, len),
        RD_KAFKA_V_OPAQUE(NULL),
        RD_KAFKA_V_END);
    
    printf("%s\n", json);
}

int main(int argc, char *argv[]) {
    int opt;
    int target_pid = -1;
    char *kafka_brokers = "localhost:9092";
    char *kafka_topic = "syscalls";
    
    while ((opt = getopt(argc, argv, "p:k:t:h")) != -1) {
        switch (opt) {
            case 'p':
                target_pid = atoi(optarg);
                break;
            case 'k':
                kafka_brokers = optarg;
                break;
            case 't':
                kafka_topic = optarg;
                break;
            case 'h':
                print_usage(argv[0]);
                return 0;
            default:
                print_usage(argv[0]);
                return 1;
        }
    }
    
    if (target_pid == -1) {
        fprintf(stderr, "Error: PID is required\n");
        print_usage(argv[0]);
        return 1;
    }
    
    signal(SIGINT, handle_sigint);
    signal(SIGTERM, handle_sigint);
    
    char errstr[512];
    rd_kafka_conf_t *conf = rd_kafka_conf_new();
    
    if (rd_kafka_conf_set(conf, "bootstrap.servers", kafka_brokers, errstr, sizeof(errstr)) != RD_KAFKA_CONF_OK) {
        fprintf(stderr, "Kafka config error: %s\n", errstr);
        return 1;
    }
    
    rd_kafka_t *rk = rd_kafka_new(RD_KAFKA_PRODUCER, conf, errstr, sizeof(errstr));
    if (!rk) {
        fprintf(stderr, "Failed to create Kafka producer: %s\n", errstr);
        return 1;
    }
    
    char pid_filter[64];
    snprintf(pid_filter, sizeof(pid_filter), "#define TARGET_PID %d\n", target_pid);
    
    char *bpf_program = malloc(strlen(pid_filter) + strlen(BPF_PROGRAM_OPEN) + 1);
    strcpy(bpf_program, pid_filter);
    strcat(bpf_program, BPF_PROGRAM_OPEN);
    
    struct bpf_module *mod = bpf_module_create_c_from_string(bpf_program, 0, NULL, 0);
    free(bpf_program);
    
    if (!mod) {
        fprintf(stderr, "Failed to compile BPF program\n");
        rd_kafka_destroy(rk);
        return 1;
    }
    
    int res = bpf_attach_tracepoint(mod, "syscalls", "sys_enter_open",
        bpf_function_start(mod, "tracepoint__syscalls__sys_enter_open"), 0);
    if (res < 0) {
        fprintf(stderr, "Failed to attach open tracepoint\n");
    }
    
    res = bpf_attach_tracepoint(mod, "syscalls", "sys_exit_open",
        bpf_function_start(mod, "tracepoint__syscalls__sys_exit_open"), 0);
    if (res < 0) {
        fprintf(stderr, "Failed to attach open_exit tracepoint\n");
    }
    
    res = bpf_attach_tracepoint(mod, "syscalls", "sys_enter_read",
        bpf_function_start(mod, "tracepoint__syscalls__sys_enter_read"), 0);
    if (res < 0) {
        fprintf(stderr, "Failed to attach read tracepoint\n");
    }
    
    res = bpf_attach_tracepoint(mod, "syscalls", "sys_exit_read",
        bpf_function_start(mod, "tracepoint__syscalls__sys_exit_read"), 0);
    if (res < 0) {
        fprintf(stderr, "Failed to attach read_exit tracepoint\n");
    }
    
    res = bpf_attach_tracepoint(mod, "syscalls", "sys_enter_write",
        bpf_function_start(mod, "tracepoint__syscalls__sys_enter_write"), 0);
    if (res < 0) {
        fprintf(stderr, "Failed to attach write tracepoint\n");
    }
    
    res = bpf_attach_tracepoint(mod, "syscalls", "sys_exit_write",
        bpf_function_start(mod, "tracepoint__syscalls__sys_exit_write"), 0);
    if (res < 0) {
        fprintf(stderr, "Failed to attach write_exit tracepoint\n");
    }
    
    res = bpf_attach_tracepoint(mod, "syscalls", "sys_enter_connect",
        bpf_function_start(mod, "tracepoint__syscalls__sys_enter_connect"), 0);
    if (res < 0) {
        fprintf(stderr, "Failed to attach connect tracepoint\n");
    }
    
    res = bpf_attach_tracepoint(mod, "syscalls", "sys_exit_connect",
        bpf_function_start(mod, "tracepoint__syscalls__sys_exit_connect"), 0);
    if (res < 0) {
        fprintf(stderr, "Failed to attach connect_exit tracepoint\n");
    }
    
    struct perf_reader *reader = bpf_attach_perf_event(mod, "events", 4096, handle_event, NULL, rk, -1);
    if (!reader) {
        fprintf(stderr, "Failed to attach perf reader\n");
        bpf_module_destroy(mod);
        rd_kafka_destroy(rk);
        return 1;
    }
    
    printf("Monitoring PID %d. Press Ctrl+C to stop...\n", target_pid);
    
    while (running) {
        if (reader) {
            perf_reader_poll(1, &reader, 100);
        }
        rd_kafka_poll(rk, 0);
    }
    
    printf("\nStopping...\n");
    
    perf_reader_free(reader);
    bpf_module_destroy(mod);
    rd_kafka_flush(rk, 10000);
    rd_kafka_destroy(rk);
    
    return 0;
}