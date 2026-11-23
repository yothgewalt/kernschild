#!/usr/bin/env bash
set -euo pipefail

node=$1 vmid=$2 script=$3
shift 3

name=$(basename "$script" .sh)
unit="guest-exec-${name}"
log="/var/log/${unit}.log"
api="${PROXMOX_VE_ENDPOINT%/}/api2/json/nodes/${node}/qemu/${vmid}/agent"
deadline=$((SECONDS + ${GUEST_EXEC_TIMEOUT:-3600}))

pve() { curl -sSk --fail-with-body -H "Authorization: PVEAPIToken=${PROXMOX_VE_API_TOKEN}" "$@"; }

check_deadline() {
    (( SECONDS < deadline )) || { echo "guest-exec: timed out waiting for $1" >&2; exit 124; }
}

agent_exec() {
    local args=() pid status
    for a in "$@"; do args+=(--data-urlencode "command=${a}"); done
    pid=$(pve -X POST "$api/exec" "${args[@]}" 2>/dev/null | jq -er '.data.pid') || return 255
    for _ in $(seq 120); do
        status=$(pve "$api/exec-status?pid=${pid}" 2>/dev/null) || return 255
        if jq -e '.data.exited == true or .data.exited == 1' >/dev/null <<<"$status"; then
            jq -r '.data["out-data"] // empty' <<<"$status"
            return "$(jq -r '.data.exitcode // 1' <<<"$status")"
        fi
        sleep 0.5
    done
    return 255
}

until pve -X POST "$api/ping" >/dev/null 2>&1; do
    check_deadline "guest agent on VM ${vmid}"
    sleep 5
done

agent_exec systemctl stop "$unit" >/dev/null || true
agent_exec systemctl reset-failed "$unit" >/dev/null || true
rc=0
agent_exec systemd-run --quiet --expand-environment=no --unit="$unit" \
    -p RemainAfterExit=yes -p "StandardOutput=truncate:${log}" -p StandardError=inherit \
    bash -c "$(cat "$script")" "$name" "$@" >/dev/null || rc=$?
if (( rc != 0 && rc != 255 )); then
    echo "guest-exec: systemd-run failed (exit ${rc}) on VM ${vmid}" >&2
    exit 1
fi
echo "guest-exec: started ${unit} on VM ${vmid} (log: ${log})"

while :; do
    check_deadline "${unit} to finish"
    sleep 10
    props=$(agent_exec systemctl show -p SubState -p ExecMainStatus "$unit") || continue
    sub=$(sed -n 's/^SubState=//p' <<<"$props")
    case "$sub" in
        running|start*) continue ;;
        exited|failed) break ;;
        *) echo "guest-exec: unexpected state '${sub}' for ${unit}" >&2; exit 1 ;;
    esac
done

agent_exec cat "$log" || true
code=$(sed -n 's/^ExecMainStatus=//p' <<<"$props")
code=${code:-1}

if (( code == 0 )) && [ "${GUEST_EXEC_REBOOT_IF_REQUIRED:-0}" = 1 ] \
    && agent_exec test -f /var/run/reboot-required >/dev/null; then
    old_boot=$(agent_exec cat /proc/sys/kernel/random/boot_id) || old_boot=unknown
    echo "guest-exec: reboot required, rebooting VM ${vmid}"
    pve -X POST "${api%/agent}/status/reboot" >/dev/null
    until new_boot=$(agent_exec cat /proc/sys/kernel/random/boot_id) && [ "$new_boot" != "$old_boot" ]; do
        check_deadline "VM ${vmid} to come back after reboot"
        sleep 5
    done
    echo "guest-exec: VM ${vmid} is back up"
fi

exit "$code"
