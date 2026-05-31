/*
 * Kernel Compatibility Layer for eBPF
 * Handles kernel version detection and CO-RE compatibility
 */

#ifndef __KERNEL_COMPAT_H
#define __KERNEL_COMPAT_H

#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

/* Kernel version definitions */
#define KERNEL_VERSION(a, b, c) (((a) << 16) + ((b) << 8) + (c))
#define KERNEL_5_4 KERNEL_VERSION(5, 4, 0)
#define KERNEL_5_8 KERNEL_VERSION(5, 8, 0)
#define KERNEL_5_10 KERNEL_VERSION(5, 10, 0)
#define KERNEL_5_15 KERNEL_VERSION(5, 15, 0)

/* Feature flags - used in BPF side via CO-RE */
#define FEAT_KPROBE_MULTI     (1 << 0)
#define FEAT_BPF_STACK        (1 << 1)
#define FEAT_BPF_SPIN_LOCK    (1 << 2)
#define FEAT_TP_PROBE         (1 << 3)
#define FEAT_CORE_RELO        (1 << 4)

/* Global config map - userspace populates this before loading */
struct kernel_config {
    __u32 kernel_version;
    __u32 feature_flags;
    __u32 use_tracepoint;
    __u32 compat_level;
} __attribute__((packed));

struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 1);
    __type(key, __u32);
    __type(value, struct kernel_config);
} kernel_config_map SEC(".maps");

/* CO-RE relocation helpers */
#define __CORE_RELO(type, member, kind) \
    __builtin_preserve_access_index(({ kind; }))

/* Helper to check field existence at runtime */
#define bpf_core_field_exists(field) \
    __builtin_preserve_field_info(field, BPF_FIELD_EXISTS)

/* Helper to get field offset with CO-RE */
#define bpf_core_offsetof(type, member) \
    __builtin_preserve_field_info(((type *)0)->member, BPF_FIELD_BYTE_OFFSET)

/* Helper to get field size with CO-RE */
#define bpf_core_sizeof(type, member) \
    __builtin_preserve_field_info(((type *)0)->member, BPF_FIELD_SIZE)

/* Type existence check */
#define bpf_core_type_exists(type) \
    __builtin_preserve_type_info(type, BPF_TYPE_EXISTS)

/* Safe read with CO-RE - fallback for missing fields */
#define BPF_CORE_READ_PROBE(dst, src, member) ({ \
    int err = 0; \
    if (bpf_core_field_exists(src->member)) { \
        err = bpf_core_read(dst, sizeof(*(dst)), &(src)->member); \
    } else { \
        __builtin_memset(dst, 0, sizeof(*(dst))); \
        err = -ENOENT; \
    } \
    err; \
})

/* Get kernel config - safe even if map not initialized */
static __always_inline struct kernel_config *get_kernel_config(void) {
    __u32 key = 0;
    return bpf_map_lookup_elem(&kernel_config_map, &key);
}

/* Runtime kernel version check */
static __always_inline __u32 get_kernel_version(void) {
    struct kernel_config *cfg = get_kernel_config();
    return cfg ? cfg->kernel_version : 0xFFFF0000; /* Default to latest */
}

/* Feature check helpers */
static __always_inline bool has_feature(__u32 feature) {
    struct kernel_config *cfg = get_kernel_config();
    return cfg ? (cfg->feature_flags & feature) : true;
}

static __always_inline bool use_tracepoint_fallback(void) {
    struct kernel_config *cfg = get_kernel_config();
    return cfg ? cfg->use_tracepoint : false;
}

/* Version comparison helpers */
#define KERNEL_AT_LEAST(maj, min, patch) \
    (get_kernel_version() >= KERNEL_VERSION(maj, min, patch))

#define KERNEL_BEFORE(maj, min, patch) \
    (get_kernel_version() < KERNEL_VERSION(maj, min, patch))

/* Safe spin_lock - fallback on older kernels */
static __always_inline void compat_spin_lock(struct bpf_spin_lock *lock) {
    if (has_feature(FEAT_BPF_SPIN_LOCK)) {
        bpf_spin_lock(lock);
    }
}

static __always_inline void compat_spin_unlock(struct bpf_spin_lock *lock) {
    if (has_feature(FEAT_BPF_SPIN_LOCK)) {
        bpf_spin_unlock(lock);
    }
}

/* Safe stack trace - fallback on older kernels */
static __always_inline long compat_get_stackid(void *ctx, void *map, __u64 flags) {
    if (has_feature(FEAT_BPF_STACK)) {
        return bpf_get_stackid(ctx, map, flags);
    }
    return -EOPNOTSUPP;
}

/* Task comm access with CO-RE safety */
static __always_inline int compat_get_task_comm(char *buf, size_t buf_size) {
    struct task_struct *task = (void *)bpf_get_current_task();
    if (!task) return -ESRCH;

    if (bpf_core_field_exists(task->comm)) {
        char *comm = BPF_CORE_READ(task, comm);
        if (comm) {
            __builtin_memset(buf, 0, buf_size);
            bpf_probe_read_kernel_str(buf, buf_size - 1, comm);
            return 0;
        }
    }
    return -ENOENT;
}

/* PID/TGID access with CO-RE safety */
static __always_inline __u32 compat_get_pid(void) {
    struct task_struct *task = (void *)bpf_get_current_task();
    if (!task) return 0;

    if (bpf_core_field_exists(task->pid)) {
        return BPF_CORE_READ(task, pid);
    }
    return bpf_get_current_pid_tgid() >> 32;
}

static __always_inline __u32 compat_get_tgid(void) {
    struct task_struct *task = (void *)bpf_get_current_task();
    if (!task) return 0;

    if (bpf_core_field_exists(task->tgid)) {
        return BPF_CORE_READ(task, tgid);
    }
    return bpf_get_current_pid_tgid() & 0xFFFFFFFF;
}

#endif /* __KERNEL_COMPAT_H */
