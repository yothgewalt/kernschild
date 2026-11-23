terraform {
    required_providers {
        proxmox = {
            source  = "bpg/proxmox"
            version = "0.123.1"
        }
    }
}

provider "proxmox" {
    endpoint  = var.proxmox_endpoint
    api_token = var.proxmox_api_token
    insecure  = true
}

locals {
    ip = split("/", var.ip_address)[0]

    provision_args = {
        VM_HOSTNAME = var.vm_name
        VM_USER     = var.vm_username
        VM_SSH_KEY  = trimspace(file(pathexpand(var.ssh_public_key_path)))
        VM_IP       = var.ip_address
        VM_GATEWAY  = var.gateway
        VM_DNS      = join(",", var.dns_servers)
        VM_MAC      = proxmox_virtual_environment_vm.lab.network_device[0].mac_address
    }

    guest_exec_env = {
        NODE                 = var.node_name
        VMID                 = tostring(proxmox_virtual_environment_vm.lab.vm_id)
        PROXMOX_VE_ENDPOINT  = var.proxmox_endpoint
        PROXMOX_VE_API_TOKEN = nonsensitive(var.proxmox_api_token)
    }
}

data "proxmox_virtual_environment_vms" "template" {
    node_name = var.node_name

    filter {
        name   = "name"
        values = [var.template_name]
    }

    filter {
        name   = "template"
        values = [true]
    }
}

resource "proxmox_virtual_environment_vm" "lab" {
    name            = var.vm_name
    node_name       = var.node_name
    description     = "eBPF + minikube sandbox. Managed by Terraform."
    tags            = sort(var.tags)
    on_boot         = true
    stop_on_destroy = true

    clone {
        vm_id        = data.proxmox_virtual_environment_vms.template.vms[0].vm_id
        datastore_id = var.datastore
        full         = true
    }

    agent {
        enabled = true
        trim    = true

        wait_for_ip {
            disabled = true
        }
    }

    operating_system {
        type = "l26"
    }

    cpu {
        type    = "host"
        cores   = var.cores
        sockets = 1
    }

    memory {
        dedicated = var.memory_mb
        floating  = 0
    }

    scsi_hardware = "virtio-scsi-single"

    disk {
        datastore_id = var.datastore
        interface    = "scsi0"
        size         = var.disk_gb
        iothread     = true
        discard      = "on"
        ssd          = true
    }

    network_device {
        bridge  = "vmbr0"
        vlan_id = var.vlan_id
        model   = "virtio"
        queues  = var.cores
    }

    serial_device {}

    lifecycle {
        precondition {
            condition     = length(data.proxmox_virtual_environment_vms.template.vms) == 1
            error_message = "Expected exactly one template named ${var.template_name} on ${var.node_name}."
        }
    }
}

resource "terraform_data" "provision" {
    triggers_replace = [
        proxmox_virtual_environment_vm.lab.id,
        filesha256("${path.module}/provision.sh"),
        filesha256("${path.module}/verify.sh"),
        filesha256("${path.module}/guest-exec.sh"),
        local.provision_args,
    ]

    provisioner "local-exec" {
        command = <<-EOT
            GUEST_EXEC_REBOOT_IF_REQUIRED=1 bash '${path.module}/guest-exec.sh' "$NODE" "$VMID" '${path.module}/provision.sh' \
                "$VM_HOSTNAME" "$VM_USER" "$VM_SSH_KEY" "$VM_IP" "$VM_GATEWAY" "$VM_DNS" "$VM_MAC" &&
            bash '${path.module}/guest-exec.sh' "$NODE" "$VMID" '${path.module}/verify.sh' "$VM_USER"
        EOT

        environment = merge(local.provision_args, local.guest_exec_env)
    }
}

resource "terraform_data" "vim" {
    count = var.vim_ide ? 1 : 0

    triggers_replace = [
        terraform_data.provision.id,
        filesha256("${path.module}/vim.sh"),
        var.vm_username,
    ]

    provisioner "local-exec" {
        command     = "bash '${path.module}/guest-exec.sh' \"$NODE\" \"$VMID\" '${path.module}/vim.sh' \"$VM_USER\""
        environment = merge(local.guest_exec_env, { VM_USER = var.vm_username })
    }
}

output "ssh" {
    value = "ssh ${var.vm_username}@${local.ip}"
}
