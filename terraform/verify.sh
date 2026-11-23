#!/usr/bin/env bash
set -euo pipefail

login_user=$1
fail=0

check() {
    local desc=$1
    shift
    if "$@" >/dev/null 2>&1; then
        echo "ok    ${desc}"
    else
        echo "FAIL  ${desc}"
        fail=1
    fi
}

check "bpf LSM active ($(cat /sys/kernel/security/lsm))" grep -qw bpf /sys/kernel/security/lsm
check "lsm= on kernel cmdline" grep -q 'lsm=[^ ]*bpf' /proc/cmdline
check "BTF at /sys/kernel/btf/vmlinux" test -r /sys/kernel/btf/vmlinux
check "docker service active" systemctl is-active --quiet docker
check "${login_user} can use docker without sudo" runuser -l "$login_user" -c 'docker info'
check "memlock unlimited in ${login_user} login sessions" sh -c \
    "systemd-run --quiet --wait --pipe -p PAMName=login -p User=${login_user} sh -c 'ulimit -l' | grep -qx unlimited"
for tool in clang llc bpftool bpftrace pkg-config git; do
    check "${tool} installed" command -v "$tool"
done
check "linux-tools-$(uname -r) installed" dpkg -s "linux-tools-$(uname -r)"

echo "kernel: $(uname -r)"
exit "$fail"
