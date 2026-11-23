//go:build ignore
#include <header/kernel_btf.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

char LICENSE[] SEC("license") = "GPL";

struct event_t {
    __u32 pid;
    __u64 cgroup_id;
};
