#!/usr/bin/env bash
set -euo pipefail

hostname=$1 login_user=$2 ssh_key=$3 ip_cidr=$4 gateway=$5 dns_csv=$6 mac=${7,,}

apt_get() {
    DEBIAN_FRONTEND=noninteractive apt-get -y -qq \
        -o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confold "$@" </dev/null
}

marker=/var/lib/kernschild/identity-reset
if [ ! -f "$marker" ]; then
    rm -f /etc/machine-id /var/lib/dbus/machine-id
    systemd-machine-id-setup >/dev/null
    ln -sf /etc/machine-id /var/lib/dbus/machine-id
    rm -f /etc/ssh/ssh_host_*
    ssh-keygen -A >/dev/null
    systemctl restart ssh
    install -d /var/lib/kernschild && touch "$marker"
fi

rm -f /etc/netplan/00-installer-config.yaml
cat >/etc/netplan/50-kernschild.yaml <<EOF
network:
  version: 2
  ethernets:
    lan0:
      match:
        macaddress: "${mac}"
      addresses: [${ip_cidr}]
      routes:
        - to: default
          via: ${gateway}
      nameservers:
        addresses: [${dns_csv}]
EOF
chmod 600 /etc/netplan/50-kernschild.yaml
netplan apply

hostnamectl set-hostname "$hostname"
sed -i '/^127\.0\.1\.1[[:space:]]/d' /etc/hosts
echo "127.0.1.1 ${hostname}" >>/etc/hosts

id "$login_user" >/dev/null 2>&1 || useradd -m -s /bin/bash -G sudo "$login_user"
home=$(getent passwd "$login_user" | cut -d: -f6)
install -d -m 0700 -o "$login_user" -g "$login_user" "$home/.ssh"
echo "$ssh_key" >"$home/.ssh/authorized_keys"
chown "$login_user:$login_user" "$home/.ssh/authorized_keys"
chmod 0600 "$home/.ssh/authorized_keys"
echo "$login_user ALL=(ALL) NOPASSWD:ALL" >"/etc/sudoers.d/90-$login_user"
chmod 0440 "/etc/sudoers.d/90-$login_user"

for _ in $(seq 60); do
    getent hosts download.docker.com >/dev/null && break
    sleep 2
done

DEBIAN_FRONTEND=noninteractive dpkg --configure -a --force-confold </dev/null
apt_get update
apt_get install ca-certificates curl

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
codename=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${codename}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

cat >/etc/sysctl.d/90-kernschild.conf <<'EOF'
fs.inotify.max_user_watches = 1048576
fs.inotify.max_user_instances = 8192
EOF
sysctl --system >/dev/null

install -m 0755 -d /etc/docker
echo '{"log-driver": "json-file", "log-opts": {"max-size": "10m", "max-file": "3"}}' >/etc/docker/daemon.json

apt_get update
apt_get upgrade
apt_get install \
    qemu-guest-agent \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
    build-essential clang llvm libbpf-dev libelf-dev zlib1g-dev pkg-config gcc-multilib \
    dwarves bpftool bpftrace bpfcc-tools \
    linux-tools-common "linux-tools-$(uname -r)" linux-tools-generic \
    linux-headers-generic "linux-headers-$(uname -r)" \
    git

systemctl enable --now containerd docker
getent group docker >/dev/null || groupadd docker
usermod -aG docker "$login_user"

cat >/etc/security/limits.d/90-memlock.conf <<'EOF'
*    soft memlock unlimited
*    hard memlock unlimited
root soft memlock unlimited
root hard memlock unlimited
EOF

lsm_active=$(cat /sys/kernel/security/lsm)
if [[ ",${lsm_active}," != *",bpf,"* ]]; then
    install -m 0755 -d /etc/default/grub.d
    printf 'GRUB_CMDLINE_LINUX_DEFAULT="${GRUB_CMDLINE_LINUX_DEFAULT} lsm=%s,bpf"\n' "$lsm_active" \
        >/etc/default/grub.d/90-kernschild-lsm.cfg
    update-grub
    touch /var/run/reboot-required
fi

echo "ip:      $(ip -4 -br addr show | awk '$1 != "lo" {print $1, $3}')"
echo "docker:  $(docker --version)"
echo "clang:   $(clang --version | head -1)"
echo "bpftool: $(bpftool version | head -1)"
echo "lsm:     ${lsm_active}"
