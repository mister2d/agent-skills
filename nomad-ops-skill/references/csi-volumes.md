# Nomad CSI & Host Volume Reference

## Overview

Nomad supports two volume types:

| Type | Provisioning | API Prefix | Use-case |
|------|-------------|------------|----------|
| **CSI** | External storage provider + plugin | `/v1/volume/csi/` | Cloud disks (EBS, GCE PD, Ceph RBD, etc.) |
| **Host** | Nomad client config (`host_volume` block) | `/v1/volume/host/` | Local paths, tmpfs, NFS mounts pre-mounted on nodes |

---

## CSI Access Mode × Attachment Mode Matrix

Every CSI volume has two orthogonal capability dimensions. Declare one or more
`RequestedCapabilities` entries when registering or creating a volume.

### `AccessMode` — how many nodes / tasks may access simultaneously

| Value | Description |
|-------|-------------|
| `single-node-reader-only` | One node, read-only |
| `single-node-writer` | One node, read-write (most common) |
| `multi-node-reader-only` | Many nodes, read-only ("ReadOnlyMany") |
| `multi-node-single-writer` | Many nodes read, one node writes ("ReadWriteOnce" with multi-reader) |
| `multi-node-multi-writer` | Many nodes read-write (requires plugin support) |

### `AttachmentMode` — how the volume is presented to the task

| Value | Description |
|-------|-------------|
| `file-system` | Mounted as a directory; Nomad creates a filesystem if needed |
| `block-device` | Presented as a raw block device (`/dev/sdX`) |

### Valid combinations

Not all drivers support all combinations. Declare the supported matrix in
`RequestedCapabilities` and Nomad selects the first satisfying match:

```json
{
  "RequestedCapabilities": [
    { "AccessMode": "single-node-writer",       "AttachmentMode": "file-system" },
    { "AccessMode": "single-node-writer",       "AttachmentMode": "block-device" },
    { "AccessMode": "multi-node-single-writer", "AttachmentMode": "file-system" }
  ]
}
```

---

## Register an Existing CSI Volume

Use **register** when the volume already exists in the storage provider.
Nomad records it in its state; no storage is allocated.

```ts
await nomad.volumes.csiRegister("my-vol-id", {
  Volumes: [{
    ID: "my-vol-id",
    Name: "my-vol",
    PluginID: "aws-ebs0",
    ExternalID: "vol-0abc1234def56789",   // provider-specific volume handle
    Namespace: "default",
    AccessMode: "single-node-writer",
    AttachmentMode: "file-system",
    RequestedCapabilities: [
      { AccessMode: "single-node-writer", AttachmentMode: "file-system" },
      { AccessMode: "single-node-writer", AttachmentMode: "block-device" },
    ],
    MountOptions: { FsType: "ext4", MountFlags: ["noatime"] },
    Secrets: { "aws-access-key": "...", "aws-secret-key": "..." },
    Parameters: {},
    Context: {},
    Topologies: [{ Segments: { "topology.ebs.csi.aws.com/zone": "us-east-1a" } }],
  }]
});
```

---

## Create a New CSI Volume

Use **create** when the plugin implements the Controller Create/Delete RPC
(e.g. AWS EBS CSI driver). Nomad calls the plugin to allocate storage in the
provider, then registers it automatically.

```ts
await nomad.volumes.csiCreate("my-new-vol", {
  Volumes: [{
    ID: "my-new-vol",
    Name: "my-new-vol",
    PluginID: "aws-ebs0",
    Namespace: "default",
    AccessMode: "single-node-writer",
    AttachmentMode: "file-system",
    RequestedCapacityMin: 10 * 1024 * 1024 * 1024,   // 10 GiB in bytes
    RequestedCapacityMax: 20 * 1024 * 1024 * 1024,
    RequestedCapabilities: [
      { AccessMode: "single-node-writer", AttachmentMode: "file-system" },
    ],
    MountOptions: { FsType: "ext4" },
    Parameters: { type: "gp3", iops: "3000" },
    Secrets: {},
    SnapshotID: "snap-12345",   // optional: restore from snapshot
    CloneID: "",                 // optional: clone existing volume
    Topologies: [],
  }]
});
```

---

## Volume Lifecycle

```
Register / Create
      │
      ▼
  [registered]  ──────────── no allocations using it
      │
  job submit referencing volume
      │
      ▼
  [claim]  ─── Nomad issues CSI ControllerPublishVolume RPC
      │
  task running
      │
  task stops / alloc GC
      │
      ▼
  [unclaim]  ── Nomad issues CSI ControllerUnpublishVolume RPC
      │
  ┌───┴────────────────────────────────────────┐
  │                                            │
Deregister                               Delete (provider)
(removes from Nomad state;            (removes from provider;
 volume still exists in provider)      also deregisters from Nomad)
```

**Deregister** — safe to call when no allocations claim the volume:
```ts
await nomad.volumes.csiDeregister("my-vol-id", /* force= */ false);
```

**Delete** — calls the plugin's Delete RPC; sends an optional secrets header:
```ts
await nomad.volumes.csiDelete("my-vol-id", { "aws-secret-key": "..." });
// HTTP header: X-Nomad-CSI-Secrets: aws-secret-key=...
```

**Detach** — manually unpublish from a specific node (for maintenance):
```ts
await nomad.volumes.csiDetach("my-vol-id", "node-uuid");
```

---

## CSI Secrets Header

Some operations pass driver credentials that must not be stored in Nomad state.
Send them as a comma-separated `key=value` header:

```
X-Nomad-CSI-Secrets: secret-key-1=value-1,secret-key-2=value-2
```

Affected endpoints:
- `DELETE /v1/volume/csi/:id/delete` — delete volume
- `POST /v1/volumes/snapshot` — create snapshot
- `DELETE /v1/volumes/snapshot` — delete snapshot

The `csiDelete`, `snapshotCreate`, and `snapshotDelete` methods in
`VolumesClient` accept a `secrets` parameter and set this header automatically.

---

## Snapshot Management

**List snapshots for a plugin:**
```ts
const snaps = await nomad.volumes.snapshotList("aws-ebs0");
```

**Create a snapshot:**
```ts
await nomad.volumes.snapshotCreate({
  PluginID: "aws-ebs0",
  Name: "my-vol-snap-20260101",
  VolumeID: "my-vol-id",
  Secrets: { "aws-access-key": "..." },
  Parameters: { "csi.storage.k8s.io/volumesnapshot": "true" },
});
```

**Delete a snapshot:**
```ts
await nomad.volumes.snapshotDelete("aws-ebs0", "snap-12345", { "aws-access-key": "..." });
```

---

## External Volume List

Lists volumes known to the plugin but not necessarily registered in Nomad.
Useful for importing existing storage:

```ts
const external = await nomad.volumes.csiListExternal("aws-ebs0", { perPage: 20 });
// external.data.Volumes[] — each has ExternalID, CapacityBytes, IsAbnormal, ...
```

---

## Dynamic Host Volumes

Dynamic host volumes are allocated on client nodes and backed by the node's
local storage (or a pre-mounted path). Unlike static `host_volume` entries in
the client configuration, they are created through the API.

```ts
// Create
await nomad.volumes.hostCreate({
  Name: "scratch",
  Namespace: "default",
  PluginID: "mkdir",             // built-in: mkdir | raw (or custom)
  NodeID: "node-uuid",           // pin to specific client
  NodePool: "compute",           // or pick by pool
  RequestedCapacityMinBytes: 1_073_741_824,   // 1 GiB
  RequestedCapacityMaxBytes: 10_737_418_240,  // 10 GiB
  Parameters: { path: "/data/scratch" },
});

// Read
const vol = await nomad.volumes.hostRead("scratch");

// Delete (provider must implement Delete RPC)
await nomad.volumes.hostDelete("scratch", "node-uuid");
```

**Host volume in a job:**
```hcl
group "app" {
  volume "scratch" {
    type   = "host"
    source = "scratch"    # matches volume Name registered in Nomad
  }

  task "app" {
    volume_mount {
      volume      = "scratch"
      destination = "/data"
    }
  }
}
```

---

## CSI Plugin Management

CSI plugins run as Nomad jobs of type `system` (node plugins) or `service`
(controller plugins).

**List plugins:**
```ts
await nomad.plugins.list({ type: "csi" });
```

**Read plugin status (includes health, node fingerprints):**
```ts
await nomad.plugins.csiRead("aws-ebs0");
```

A healthy plugin shows `ControllerRequired: true` (if applicable) and
`NodesHealthy > 0`.

---

## Volume in Job Spec (Quick Reference)

```hcl
group "app" {
  volume "data" {
    type            = "csi"
    source          = "my-vol-id"
    attachment_mode = "file-system"
    access_mode     = "single-node-writer"
    read_only       = false
    per_alloc       = false

    mount_options {
      fs_type     = "ext4"
      mount_flags = ["noatime", "nodiratime"]
    }
  }

  task "server" {
    volume_mount {
      volume           = "data"
      destination      = "/var/data"
      read_only        = false
      propagation_mode = "private"
    }
  }
}
```

`per_alloc = true` suffixes the volume source with the alloc index
(`my-vol-id[0]`, `my-vol-id[1]`, …) allowing each alloc in a group to have
its own independent volume.
