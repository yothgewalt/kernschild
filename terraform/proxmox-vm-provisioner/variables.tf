variable "proxmox_endpoint" {
    description = "Proxmox API URL, e.g. https://10.10.10.11:8006/."
    type        = string

    validation {
        condition     = can(regex("^https://", var.proxmox_endpoint))
        error_message = "proxmox_endpoint must start with https://."
    }
}

variable "proxmox_api_token" {
    description = "API token as user@realm!tokenid=secret."
    type        = string
    sensitive   = true

    validation {
        condition     = can(regex("^[^@!=]+@[^@!=]+![^@!=]+=[0-9a-f-]{36}$", var.proxmox_api_token))
        error_message = "proxmox_api_token must look like user@realm!tokenid=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx."
    }
}

variable "node_name" {
    description = "Proxmox node that holds the template and runs the VM."
    type        = string
}

variable "template_name" {
    description = "Name of the template VM on node_name to clone."
    type        = string
}

variable "datastore" {
    description = "Storage for the VM disk."
    type        = string
}

variable "vm_name" {
    description = "VM name and guest hostname."
    type        = string
}

variable "vm_username" {
    description = "Login user created by cloud-init, member of sudo and docker."
    type        = string
}

variable "ssh_public_key_path" {
    description = "Public key authorized for vm_username, for your own logins (Terraform does not SSH)."
    type        = string
}

variable "tags" {
    description = "Proxmox tags; sorted automatically."
    type        = list(string)
}

variable "ip_address" {
    description = "Static IPv4 in CIDR notation, e.g. 10.10.50.50/24."
    type        = string

    validation {
        condition     = can(cidrhost(var.ip_address, 0))
        error_message = "ip_address must be CIDR notation, e.g. 10.10.50.50/24."
    }
}

variable "gateway" {
    description = "IPv4 default gateway inside ip_address's subnet."
    type        = string

    validation {
        condition     = can(cidrhost("${var.gateway}/32", 0))
        error_message = "gateway must be a plain IPv4 address."
    }
}

variable "vlan_id" {
    description = "VLAN tag on the bridge (vmbr0 must be VLAN-aware)."
    type        = number

    validation {
        condition     = var.vlan_id >= 1 && var.vlan_id <= 4094
        error_message = "vlan_id must be between 1 and 4094."
    }
}

variable "dns_servers" {
    description = "DNS servers handed to the guest."
    type        = list(string)
}

variable "cores" {
    description = "vCPU count; also used as the NIC queue count."
    type        = number
}

variable "memory_mb" {
    description = "Dedicated RAM in MiB (ballooning disabled)."
    type        = number
}

variable "disk_gb" {
    description = "Boot disk size in GB. Must be >= the template's disk; Proxmox cannot shrink disks."
    type        = number
}

variable "vim_ide" {
    description = "Set up Vim for vm_username: NERDTree, LSP completion for Go (gopls) and C/C++ (clangd), fzf, git plugins, plus go, dlv, gdb, ripgrep and bear. Setting false later does not uninstall anything."
    type        = bool
    default     = true
}
