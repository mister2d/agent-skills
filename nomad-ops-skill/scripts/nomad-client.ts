#!/usr/bin/env npx ts-node
/**
 * nomad-client.ts — Full Nomad HTTP API client (v1.11.x)
 *
 * Usage:  npx ts-node scripts/nomad-client.ts <resource> <action> [args...]
 * Config: NOMAD_ADDR | NOMAD_TOKEN | NOMAD_NAMESPACE | NOMAD_REGION
 *
 * Zero hardcoded infrastructure. All values sourced from env or CLI args.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────
import * as crypto from "crypto";
import * as fs from "fs";
import * as https from "https";
import * as http from "http";
import * as net from "net";
import * as path from "path";
import * as readline from "readline";
import * as tls from "tls";
import { URL } from "url";

// ─────────────────────────────────────────────────────────────────────────────
// Core Types
// ─────────────────────────────────────────────────────────────────────────────

export interface NomadConfig {
  addr: string;
  token?: string;
  namespace?: string;
  region?: string;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  tlsSkipVerify?: boolean;
}

export interface QueryOptions {
  namespace?: string;
  region?: string;
  index?: number;
  wait?: string;
  prefix?: string;
  filter?: string;
  perPage?: number;
  nextToken?: string;
  reverse?: boolean;
  stale?: boolean;
}

export interface WriteMeta {
  index: number;
  lastContact?: number;
  knownLeader?: boolean;
}

export interface QueryMeta {
  index: number;
  lastContact?: number;
  knownLeader?: boolean;
  nextToken?: string;
}

export interface ApiResponse<T = unknown> {
  data: T;
  meta?: QueryMeta;
  statusCode: number;
}

export class NomadApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly endpoint: string,
    public readonly body?: string
  ) {
    super(message);
    this.name = "NomadApiError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Job Spec Types
// ─────────────────────────────────────────────────────────────────────────────

export interface NomadJobMeta {
  [key: string]: string;
}

export interface NomadConstraint {
  LTarget?: string;
  RTarget?: string;
  Operand?: string;
}

export interface NomadAffinity {
  LTarget?: string;
  RTarget?: string;
  Operand?: string;
  Weight?: number;
}

export interface NomadSpread {
  Attribute?: string;
  Weight?: number;
  SpreadTarget?: Array<{ Value: string; Percent: number }>;
}

export interface NomadResources {
  CPU?: number;
  Cores?: number;
  MemoryMB?: number;
  MemoryMaxMB?: number;
  DiskMB?: number;
  Networks?: NomadNetwork[];
  Devices?: NomadRequestedDevice[];
  NUMA?: { Affinity?: string };
}

export interface NomadNetwork {
  Mode?: string;
  Device?: string;
  CIDR?: string;
  IP?: string;
  MBits?: number;
  DNS?: { Servers?: string[]; Searches?: string[]; Options?: string[] };
  ReservedPorts?: Array<{ Label: string; Value: number; To?: number; HostNetwork?: string }>;
  DynamicPorts?: Array<{ Label: string; Value?: number; To?: number; HostNetwork?: string }>;
}

export interface NomadRequestedDevice {
  Name: string;
  Count?: number;
  Constraints?: NomadConstraint[];
  Affinities?: NomadAffinity[];
}

export interface NomadVolumeMount {
  Volume?: string;
  Destination?: string;
  ReadOnly?: boolean;
  PropagationMode?: string;
  SELinuxLabel?: string;
}

export interface NomadVolumeRequest {
  Name?: string;
  Type?: "csi" | "host";
  Source?: string;
  ReadOnly?: boolean;
  AccessMode?: string;
  AttachmentMode?: string;
  MountOptions?: { FsType?: string; MountFlags?: string[] };
  PerAlloc?: boolean;
}

export interface NomadTemplate {
  SourcePath?: string;
  DestPath?: string;
  EmbeddedTmpl?: string;
  ChangeMode?: "noop" | "restart" | "signal" | "script";
  ChangeSignal?: string;
  ChangeScript?: { Command?: string; Args?: string[]; Timeout?: string; FailOnError?: boolean };
  Splay?: number;
  Perms?: string;
  Uid?: number;
  Gid?: number;
  LeftDelim?: string;
  RightDelim?: string;
  Envvars?: boolean;
  VaultGrace?: number;
  Wait?: { Min?: string; Max?: string };
  ErrMissingKey?: boolean;
}

export interface NomadArtifact {
  GetterSource?: string;
  GetterOptions?: Record<string, string>;
  GetterHeaders?: Record<string, string>;
  GetterMode?: "any" | "file" | "dir";
  RelativeDest?: string;
}

export interface NomadServiceCheck {
  Id?: string;
  Name?: string;
  Type?: string;
  Command?: string;
  Args?: string[];
  Path?: string;
  Protocol?: string;
  PortLabel?: string;
  AddressMode?: string;
  Interval?: number;
  Timeout?: number;
  InitialStatus?: string;
  TLSServerName?: string;
  TLSSkipVerify?: boolean;
  Header?: Record<string, string[]>;
  Method?: string;
  Body?: string;
  CheckRestart?: { Limit?: number; Grace?: string; IgnoreWarnings?: boolean };
  GRPCService?: string;
  GRPCUseTLS?: boolean;
  TaskName?: string;
  SuccessBeforePassing?: number;
  FailuresBeforeCritical?: number;
  FailuresBeforeWarning?: number;
  OnUpdate?: string;
}

export interface NomadService {
  Id?: string;
  Name?: string;
  Tags?: string[];
  CanaryTags?: string[];
  EnableTagOverride?: boolean;
  PortLabel?: string;
  AddressMode?: string;
  Address?: string;
  Meta?: Record<string, string>;
  CanaryMeta?: Record<string, string>;
  TaggedAddresses?: Record<string, string>;
  Checks?: NomadServiceCheck[];
  Connect?: {
    Native?: boolean;
    SidecarService?: Record<string, unknown>;
    SidecarTask?: Record<string, unknown>;
    Gateway?: Record<string, unknown>;
  };
  Provider?: "consul" | "nomad";
  Weights?: { Passing?: number; Warning?: number };
  Cluster?: string;
}

export interface NomadLogConfig {
  MaxFiles?: number;
  MaxFileSizeMB?: number;
  Disabled?: boolean;
}

export interface NomadTask {
  Name?: string;
  Driver?: string;
  User?: string;
  Config?: Record<string, unknown>;
  Constraints?: NomadConstraint[];
  Affinities?: NomadAffinity[];
  Env?: Record<string, string>;
  Services?: NomadService[];
  Resources?: NomadResources;
  RestartPolicy?: { Interval?: number; Attempts?: number; Delay?: number; Mode?: string };
  Meta?: Record<string, string>;
  KillTimeout?: number;
  LogConfig?: NomadLogConfig;
  Artifacts?: NomadArtifact[];
  Vault?: {
    Cluster?: string;
    Policies?: string[];
    Namespace?: string;
    Env?: boolean;
    File?: boolean;
    DisableFile?: boolean;
    ChangeMode?: string;
    ChangeSignal?: string;
  };
  Identity?: {
    Name?: string;
    Audience?: string[];
    Env?: boolean;
    File?: boolean;
    TTL?: number;
    ChangeMode?: string;
    ChangeSignal?: string;
    ServiceName?: string;
  };
  Identities?: Array<Record<string, unknown>>;
  Templates?: NomadTemplate[];
  DispatchPayload?: { File?: string };
  VolumeMounts?: NomadVolumeMount[];
  Leader?: boolean;
  ShutdownDelay?: number;
  StopAfterClientDisconnect?: number;
  MaxClientDisconnect?: string;
  Actions?: Array<{ Name: string; Command: string; Args?: string[] }>;
  CSIPluginConfig?: {
    ID?: string;
    Type?: "node" | "controller" | "monolith";
    MountDir?: string;
    StagePublishBaseDir?: string;
    HealthTimeout?: string;
  };
  Kind?: string;
  ScalingPolicies?: Array<Record<string, unknown>>;
}

export interface NomadTaskGroup {
  Name?: string;
  Count?: number;
  Constraints?: NomadConstraint[];
  Affinities?: NomadAffinity[];
  Spreads?: NomadSpread[];
  Tasks?: NomadTask[];
  RestartPolicy?: { Interval?: number; Attempts?: number; Delay?: number; Mode?: string };
  ReschedulePolicy?: {
    Attempts?: number;
    Interval?: number;
    Delay?: number;
    DelayFunction?: string;
    MaxDelay?: number;
    Unlimited?: boolean;
  };
  EphemeralDisk?: { Sticky?: boolean; Migrate?: boolean; SizeMB?: number };
  Volumes?: Record<string, NomadVolumeRequest>;
  Update?: NomadUpdateStrategy;
  Migrate?: { MaxParallel?: number; HealthCheck?: string; MinHealthyTime?: number; HealthyDeadline?: number };
  Networks?: NomadNetwork[];
  Services?: NomadService[];
  Meta?: Record<string, string>;
  ShutdownDelay?: number;
  StopAfterClientDisconnect?: number;
  MaxClientDisconnect?: string;
  Scaling?: Record<string, unknown>;
  Consul?: { Cluster?: string; Namespace?: string; Partition?: string };
  PreventRescheduleOnLost?: boolean;
  NUMAResources?: Record<string, unknown>;
}

export interface NomadUpdateStrategy {
  Stagger?: number;
  MaxParallel?: number;
  HealthCheck?: string;
  MinHealthyTime?: number;
  HealthyDeadline?: number;
  ProgressDeadline?: number;
  AutoRevert?: boolean;
  AutoPromote?: boolean;
  Canary?: number;
}

export interface NomadJob {
  ID?: string;
  ParentID?: string;
  Name?: string;
  Namespace?: string;
  Region?: string;
  Type?: "service" | "batch" | "system" | "sysbatch";
  Priority?: number;
  AllAtOnce?: boolean;
  Datacenters?: string[];
  NodePool?: string;
  Constraints?: NomadConstraint[];
  Affinities?: NomadAffinity[];
  Spreads?: NomadSpread[];
  TaskGroups?: NomadTaskGroup[];
  Update?: NomadUpdateStrategy;
  Multiregion?: {
    Strategy?: { MaxParallel?: number; OnFailure?: string };
    Regions?: Array<{ Name: string; Count?: number; Datacenters?: string[] }>;
  };
  Periodic?: {
    Enabled?: boolean;
    Spec?: string;
    SpecType?: string;
    ProhibitOverlap?: boolean;
    TimeZone?: string;
  };
  ParameterizedJob?: {
    Payload?: string;
    MetaRequired?: string[];
    MetaOptional?: string[];
  };
  Reschedule?: Record<string, unknown>;
  Migrate?: Record<string, unknown>;
  Meta?: Record<string, string>;
  ConsulToken?: string;
  VaultToken?: string;
  VaultNamespace?: string;
  Stop?: boolean;
  CreateIndex?: number;
  ModifyIndex?: number;
  JobModifyIndex?: number;
  Version?: number;
  SubmitTime?: number;
  Status?: string;
  StatusDescription?: string;
  Stable?: boolean;
  NomadTokenID?: string;
}

export interface NomadJobSubmitRequest {
  Job: NomadJob;
  EnforceIndex?: boolean;
  JobModifyIndex?: number;
  PolicyOverride?: boolean;
  PreserveCounts?: boolean;
  EvalPriority?: number;
  Namespace?: string;
  Region?: string;
}

export interface NomadJobRegisterResponse {
  EvalID: string;
  EvalCreateIndex: number;
  JobModifyIndex: number;
  Warnings?: string;
  Index: number;
  LastContact?: number;
  KnownLeader?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Allocation Types
// ─────────────────────────────────────────────────────────────────────────────

export interface NomadAllocatedResources {
  Shared: {
    CpuShares: number;
    MemoryMB: number;
    Networks?: NomadNetwork[];
  };
}

export interface NomadAllocation {
  ID: string;
  Namespace?: string;
  EvalID?: string;
  Name?: string;
  NodeID?: string;
  NodeName?: string;
  JobID?: string;
  Job?: NomadJob;
  TaskGroup?: string;
  Resources?: NomadResources;
  AllocatedResources?: NomadAllocatedResources;
  Services?: Record<string, string>;
  Metrics?: Record<string, unknown>;
  DesiredStatus?: string;
  DesiredDescription?: string;
  DesiredTransition?: Record<string, unknown>;
  ClientStatus?: string;
  ClientDescription?: string;
  TaskStates?: Record<string, {
    State?: string;
    Failed?: boolean;
    Restarts?: number;
    LastRestart?: number;
    StartedAt?: string;
    FinishedAt?: string;
    Events?: Array<Record<string, unknown>>;
    TaskHandle?: Record<string, unknown>;
  }>;
  DeploymentID?: string;
  DeploymentStatus?: Record<string, unknown>;
  FollowupEvalID?: string;
  PreviousAllocation?: string;
  NextAllocation?: string;
  RescheduleTracker?: Record<string, unknown>;
  PreemptedAllocations?: string[];
  PreemptedByAllocation?: string;
  CreateIndex?: number;
  ModifyIndex?: number;
  AllocModifyIndex?: number;
  CreateTime?: number;
  ModifyTime?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Volume Types
// ─────────────────────────────────────────────────────────────────────────────

export interface NomadCSIVolume {
  ID: string;
  Name?: string;
  Namespace?: string;
  ExternalID?: string;
  Topologies?: Array<{ Segments: Record<string, string> }>;
  AccessMode?: string;
  AttachmentMode?: string;
  MountOptions?: { FsType?: string; MountFlags?: string[] };
  Secrets?: Record<string, string>;
  Parameters?: Record<string, string>;
  Context?: Record<string, string>;
  RequestedCapacityMin?: number;
  RequestedCapacityMax?: number;
  RequestedCapabilities?: Array<{ AccessMode: string; AttachmentMode: string }>;
  Capacity?: number;
  StorageClass?: string;
  Allocations?: NomadAllocation[];
  ReadAllocs?: Record<string, NomadAllocation>;
  WriteAllocs?: Record<string, NomadAllocation>;
  Schedulable?: boolean;
  PluginID?: string;
  Provider?: string;
  ProviderVersion?: string;
  ControllerRequired?: boolean;
  ControllersHealthy?: number;
  ControllersExpected?: number;
  NodesHealthy?: number;
  NodesExpected?: number;
  CreateIndex?: number;
  ModifyIndex?: number;
}

export interface NomadHostVolume {
  ID: string;
  Namespace?: string;
  Name?: string;
  PluginID?: string;
  NodeID?: string;
  NodePool?: string;
  HostPath?: string;
  State?: string;
  RequestedCapacityMin?: number;
  RequestedCapacityMax?: number;
  Capacity?: number;
  RequestedCapabilities?: Array<{ AccessMode: string; AttachmentMode: string }>;
  Parameters?: Record<string, string>;
  CreateIndex?: number;
  ModifyIndex?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation / Deployment / Node Types
// ─────────────────────────────────────────────────────────────────────────────

export interface NomadEvaluation {
  ID: string;
  Namespace?: string;
  Priority?: number;
  Type?: string;
  TriggeredBy?: string;
  JobID?: string;
  JobModifyIndex?: number;
  NodeID?: string;
  NodeModifyIndex?: number;
  DeploymentID?: string;
  Status?: string;
  StatusDescription?: string;
  Wait?: number;
  WaitUntil?: string;
  NextEval?: string;
  PreviousEval?: string;
  BlockedEval?: string;
  RelatedEvals?: string[];
  FailedTGAllocs?: Record<string, unknown>;
  ClassEligibility?: Record<string, boolean>;
  AnnotatePlan?: boolean;
  EscapedComputedClass?: boolean;
  QueuedAllocations?: Record<string, number>;
  CreateIndex?: number;
  ModifyIndex?: number;
  CreateTime?: number;
  ModifyTime?: number;
}

export interface NomadDeployment {
  ID: string;
  Namespace?: string;
  JobID?: string;
  JobVersion?: number;
  JobModifyIndex?: number;
  JobSpecModifyIndex?: number;
  JobCreateIndex?: number;
  IsMultiregion?: boolean;
  TaskGroups?: Record<string, {
    AutoRevert?: boolean;
    AutoPromote?: boolean;
    Promoted?: boolean;
    PlacedCanaries?: string[];
    DesiredCanaries?: number;
    DesiredTotal?: number;
    PlacedAllocs?: number;
    HealthyAllocs?: number;
    UnhealthyAllocs?: number;
    ProgressDeadline?: number;
    RequireProgressBy?: string;
  }>;
  Status?: string;
  StatusDescription?: string;
  CreateIndex?: number;
  ModifyIndex?: number;
}

export interface NomadNode {
  ID: string;
  SecretID?: string;
  Datacenter?: string;
  Name?: string;
  HTTPAddr?: string;
  TLSEnabled?: boolean;
  Attributes?: Record<string, string>;
  NodeResources?: {
    Cpu?: { CpuShares: number };
    Memory?: { MemoryMB: number };
    Disk?: { DiskMB: number };
    Networks?: NomadNetwork[];
  };
  ReservedResources?: Record<string, unknown>;
  Links?: Record<string, string>;
  Meta?: Record<string, string>;
  NodeClass?: string;
  NodePool?: string;
  ComputedClass?: string;
  Drain?: boolean;
  DrainStrategy?: Record<string, unknown>;
  SchedulingEligibility?: string;
  Status?: string;
  StatusDescription?: string;
  StatusUpdatedAt?: number;
  Events?: Array<Record<string, unknown>>;
  Drivers?: Record<string, {
    Detected?: boolean;
    Healthy?: boolean;
    HealthDescription?: string;
    UpdateTime?: string;
    Attributes?: Record<string, string>;
  }>;
  CSIControllerPlugins?: Record<string, unknown>;
  CSINodePlugins?: Record<string, unknown>;
  HostVolumes?: Record<string, unknown>;
  HostNetworks?: Record<string, { CIDR?: string; ReservedPorts?: string }>;
  CreateIndex?: number;
  ModifyIndex?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Variable / Namespace / ACL Types
// ─────────────────────────────────────────────────────────────────────────────

export interface NomadVariable {
  Namespace?: string;
  Path: string;
  CreateIndex?: number;
  ModifyIndex?: number;
  CreateTime?: number;
  ModifyTime?: number;
  Items?: Record<string, string>;
  Lock?: { ID?: string; TTL?: string; RenewTime?: string; LockDelay?: string };
}

export interface NomadNamespace {
  Name: string;
  Description?: string;
  Quota?: string;
  Capabilities?: { EnabledTaskDrivers?: string[]; DisabledTaskDrivers?: string[] };
  NodePoolConfiguration?: { Default?: string; Allowed?: string[]; Denied?: string[] };
  Meta?: Record<string, string>;
  CreateIndex?: number;
  ModifyIndex?: number;
}

export interface NomadNodePool {
  Name: string;
  Description?: string;
  Meta?: Record<string, string>;
  SchedulerConfiguration?: {
    SchedulerAlgorithm?: string;
    MemoryOversubscriptionEnabled?: boolean;
  };
  CreateIndex?: number;
  ModifyIndex?: number;
}

export interface NomadACLToken {
  AccessorID?: string;
  SecretID?: string;
  Name?: string;
  Type?: "management" | "client";
  Policies?: string[];
  Roles?: Array<{ ID: string; Name: string }>;
  Global?: boolean;
  ExpirationTime?: string;
  ExpirationTTL?: string;
  Namespace?: string;
  NodeID?: string;
  CreateTime?: string;
  CreateIndex?: number;
  ModifyIndex?: number;
}

export interface NomadACLPolicy {
  Name: string;
  Description?: string;
  Rules?: string;
  JobACL?: {
    Namespace?: string;
    JobID?: string;
    Group?: string;
    Task?: string;
  };
  CreateIndex?: number;
  ModifyIndex?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Client Core
// ─────────────────────────────────────────────────────────────────────────────

function buildConfig(): NomadConfig {
  const addr = process.env["NOMAD_ADDR"] ?? "http://127.0.0.1:4646";
  return {
    addr: addr.replace(/\/$/, ""),
    token: process.env["NOMAD_TOKEN"],
    // Default to "*" so list operations span all namespaces in multi-tenant clusters.
    // Set NOMAD_NAMESPACE to restrict to a specific namespace.
    namespace: process.env["NOMAD_NAMESPACE"] ?? "*",
    region: process.env["NOMAD_REGION"],
    caCert: process.env["NOMAD_CACERT"],
    clientCert: process.env["NOMAD_CLIENT_CERT"],
    clientKey: process.env["NOMAD_CLIENT_KEY"],
    tlsSkipVerify: process.env["NOMAD_TLS_SKIP_VERIFY"] === "true" || process.env["NOMAD_TLS_SKIP_VERIFY"] === "1",
  };
}

function buildQueryString(opts: QueryOptions, extra?: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  if (opts.namespace) params.set("namespace", opts.namespace);
  if (opts.region) params.set("region", opts.region);
  if (opts.index !== undefined) params.set("index", String(opts.index));
  if (opts.wait) params.set("wait", opts.wait);
  if (opts.prefix) params.set("prefix", opts.prefix);
  if (opts.filter) params.set("filter", opts.filter);
  if (opts.perPage !== undefined) params.set("per_page", String(opts.perPage));
  if (opts.nextToken) params.set("next_token", opts.nextToken);
  if (opts.reverse) params.set("reverse", "true");
  if (opts.stale) params.set("stale", "true");
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) params.set(k, String(v));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

async function nomadRequest<T>(
  config: NomadConfig,
  method: "GET" | "POST" | "PUT" | "DELETE",
  endpoint: string,
  body?: unknown,
  opts: QueryOptions = {},
  extra?: Record<string, string | number | boolean | undefined>,
  csiSecrets?: Record<string, string>
): Promise<ApiResponse<T>> {
  const qs = buildQueryString({
    namespace: opts.namespace ?? config.namespace,
    region: opts.region ?? config.region,
    ...opts,
  }, extra);
  const url = `${config.addr}/v1/${endpoint}${qs}`;

  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === "https:";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  if (config.token) {
    headers["X-Nomad-Token"] = config.token;
  }
  if (csiSecrets) {
    const s = Object.entries(csiSecrets).map(([k, v]) => `${k}=${v}`).join(",");
    headers["X-Nomad-CSI-Secrets"] = s;
  }

  const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
  if (bodyStr) headers["Content-Length"] = String(Buffer.byteLength(bodyStr));

  const tlsOptions = isHttps
    ? {
        rejectUnauthorized: !config.tlsSkipVerify,
        ...(config.caCert && { ca: fs.readFileSync(config.caCert) }),
        ...(config.clientCert && { cert: fs.readFileSync(config.clientCert) }),
        ...(config.clientKey && { key: fs.readFileSync(config.clientKey) }),
      }
    : {};

  return new Promise((resolve, reject) => {
    const reqOpts = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers,
      ...tlsOptions,
    };

    const transport = isHttps ? https : http;
    const req = transport.request(reqOpts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const statusCode = res.statusCode ?? 0;

        if (statusCode < 200 || statusCode >= 300) {
          reject(new NomadApiError(
            `HTTP ${statusCode} from ${method} ${url}: ${raw.slice(0, 300)}`,
            statusCode,
            url,
            raw
          ));
          return;
        }

        let data: T;
        if (raw.trim() === "" || raw.trim() === "null") {
          data = null as unknown as T;
        } else {
          try {
            data = JSON.parse(raw) as T;
          } catch {
            data = raw as unknown as T;
          }
        }

        const meta: QueryMeta = {
          index: Number(res.headers["x-nomad-index"] ?? 0),
          lastContact: Number(res.headers["x-nomad-lastcontact"] ?? 0),
          knownLeader: res.headers["x-nomad-knownleader"] === "true",
          nextToken: res.headers["x-nomad-nexttoken"] as string | undefined,
        };

        resolve({ data, meta, statusCode });
      });
    });

    req.on("error", (err: Error) => reject(err));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket Exec  (GET /v1/client/allocation/:id/exec  → HTTP Upgrade)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecOptions {
  /** Command to run, e.g. ["/bin/sh"] */
  command: string[];
  /** Task name within the allocation */
  task: string;
  /** Allocate a PTY (default: false) */
  tty?: boolean;
  /** Write stdin to the remote process; omit for one-shot commands */
  stdinStream?: NodeJS.ReadableStream;
  /** Called for each decoded stdout chunk */
  onStdout?: (chunk: string) => void;
  /** Called for each decoded stderr chunk */
  onStderr?: (chunk: string) => void;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * execAlloc — implements the Nomad alloc exec WebSocket protocol over a raw
 * TCP upgrade (no external ws library). The protocol sends JSON frames on both
 * sides:
 *   → { "stdin": { "data": "<b64>" } }          stdin bytes
 *   → { "stdin": { "close": true } }             EOF
 *   → { "tty_size": { "height": N, "width": N } } resize event
 *   ← { "stdout": { "data": "<b64>" } }          stdout bytes
 *   ← { "stderr": { "data": "<b64>" } }          stderr bytes
 *   ← { "exited": true }                         process exit signalled
 *   ← { "result": { "exit_code": N } }           exit code
 */
export async function execAlloc(cfg: NomadConfig, allocId: string, opts: ExecOptions): Promise<ExecResult> {
  const base = new URL(cfg.addr);
  const isTLS = base.protocol === "https:";
  const host = base.hostname;
  const port = Number(base.port) || (isTLS ? 443 : 80);

  const cmdEncoded = encodeURIComponent(JSON.stringify(opts.command));
  const taskEncoded = encodeURIComponent(opts.task);
  const tty = opts.tty ? "true" : "false";
  const reqPath = `/v1/client/allocation/${encodeURIComponent(allocId)}/exec?command=${cmdEncoded}&task=${taskEncoded}&tty=${tty}`;

  const wsKey = crypto.randomBytes(16).toString("base64");

  const headers: Record<string, string> = {
    Host: host,
    Upgrade: "websocket",
    Connection: "Upgrade",
    "Sec-WebSocket-Key": wsKey,
    "Sec-WebSocket-Version": "13",
    "Sec-WebSocket-Protocol": "binary",
  };
  if (cfg.token) headers["X-Nomad-Token"] = cfg.token;

  const rawRequest = `GET ${reqPath} HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`;

  return new Promise<ExecResult>((resolve, reject) => {
    let socket: net.Socket;

    if (isTLS) {
      const tlsOpts: import("tls").ConnectionOptions = {
        host, port,
        rejectUnauthorized: !cfg.tlsSkipVerify,
        ...(cfg.caCert ? { ca: fs.readFileSync(cfg.caCert) } : {}),
        ...(cfg.clientCert ? { cert: fs.readFileSync(cfg.clientCert) } : {}),
        ...(cfg.clientKey ? { key: fs.readFileSync(cfg.clientKey) } : {}),
      };
      socket = tls.connect(port, host, tlsOpts);
    } else {
      socket = net.createConnection(port, host);
    }

    let upgraded = false;
    let headerBuffer = Buffer.alloc(0);
    let stdoutBuf = "";
    let stderrBuf = "";
    let exitCode = 1;
    let frameBuffer = Buffer.alloc(0);

    function sendFrame(payload: Record<string, unknown>): void {
      const data = Buffer.from(JSON.stringify(payload));
      const len = data.length;
      let header: Buffer;
      if (len < 126) {
        header = Buffer.from([0x81, 0x80 | len, 0, 0, 0, 0]);
      } else if (len < 65536) {
        header = Buffer.from([0x81, 0x80 | 126, (len >> 8) & 0xff, len & 0xff, 0, 0, 0, 0]);
      } else {
        header = Buffer.from([0x81, 0x80 | 127, 0, 0, 0, 0, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, 0, 0, 0, 0]);
      }
      // Apply masking key (all-zero mask = XOR identity, still spec-compliant)
      socket.write(Buffer.concat([header, data]));
    }

    function processWebSocketData(chunk: Buffer): void {
      frameBuffer = Buffer.concat([frameBuffer, chunk]);
      while (frameBuffer.length >= 2) {
        const fin = (frameBuffer[0] & 0x80) !== 0;
        const opcode = frameBuffer[0] & 0x0f;
        const masked = (frameBuffer[1] & 0x80) !== 0;
        let payloadLen = frameBuffer[1] & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
          if (frameBuffer.length < 4) break;
          payloadLen = (frameBuffer[2] << 8) | frameBuffer[3];
          offset = 4;
        } else if (payloadLen === 127) {
          if (frameBuffer.length < 10) break;
          payloadLen = (frameBuffer[6] << 24) | (frameBuffer[7] << 16) | (frameBuffer[8] << 8) | frameBuffer[9];
          offset = 10;
        }

        const maskLen = masked ? 4 : 0;
        if (frameBuffer.length < offset + maskLen + payloadLen) break;

        let payload = frameBuffer.slice(offset + maskLen, offset + maskLen + payloadLen);
        if (masked) {
          const mask = frameBuffer.slice(offset, offset + 4);
          payload = Buffer.from(payload.map((b, i) => b ^ (mask[i % 4] ?? 0)));
        }
        frameBuffer = frameBuffer.slice(offset + maskLen + payloadLen);

        if (opcode === 0x8) { socket.end(); return; } // close frame
        if (!fin || (opcode !== 0x1 && opcode !== 0x2)) continue;

        try {
          const msg = JSON.parse(payload.toString("utf8")) as Record<string, unknown>;
          if (msg["stdout"] && typeof (msg["stdout"] as Record<string, unknown>)["data"] === "string") {
            const text = Buffer.from((msg["stdout"] as Record<string, string>)["data"], "base64").toString("utf8");
            stdoutBuf += text;
            opts.onStdout?.(text);
          } else if (msg["stderr"] && typeof (msg["stderr"] as Record<string, unknown>)["data"] === "string") {
            const text = Buffer.from((msg["stderr"] as Record<string, string>)["data"], "base64").toString("utf8");
            stderrBuf += text;
            opts.onStderr?.(text);
          } else if (msg["result"] && typeof (msg["result"] as Record<string, unknown>)["exit_code"] === "number") {
            exitCode = (msg["result"] as Record<string, number>)["exit_code"];
          } else if (msg["exited"] === true) {
            sendFrame({ stdin: { close: true } });
            socket.end();
          }
        } catch { /* malformed frame — skip */ }
      }
    }

    socket.once("connect", () => {
      socket.write(rawRequest);
    });

    socket.on("data", (chunk: Buffer) => {
      if (upgraded) {
        processWebSocketData(chunk);
        return;
      }
      headerBuffer = Buffer.concat([headerBuffer, chunk]);
      const sep = headerBuffer.indexOf("\r\n\r\n");
      if (sep === -1) return;

      const statusLine = headerBuffer.slice(0, headerBuffer.indexOf("\r\n")).toString();
      if (!statusLine.includes("101")) {
        reject(new NomadApiError(`WebSocket upgrade rejected: ${statusLine}`, 0, reqPath));
        socket.destroy();
        return;
      }
      upgraded = true;
      const rest = headerBuffer.slice(sep + 4);

      // Pipe stdin if provided
      if (opts.stdinStream) {
        opts.stdinStream.on("data", (d: Buffer | string) => {
          sendFrame({ stdin: { data: Buffer.from(d).toString("base64") } });
        });
        opts.stdinStream.on("end", () => {
          sendFrame({ stdin: { close: true } });
        });
      } else {
        sendFrame({ stdin: { close: true } });
      }

      if (rest.length > 0) processWebSocketData(rest);
    });

    socket.on("close", () => {
      resolve({ exitCode, stdout: stdoutBuf, stderr: stderrBuf });
    });

    socket.on("error", (err) => {
      reject(err);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// NDJSON Event Stream  (GET /v1/event/stream)
// ─────────────────────────────────────────────────────────────────────────────

export interface EventStreamOptions {
  /** Cluster index to start from (0 = beginning of buffer) */
  index?: number;
  /** Namespace filter; "*" = all namespaces */
  namespace?: string;
  /** Topic filter(s) e.g. "Job:redis", "Deployment:*", "Node" */
  topics?: string[];
  /** Called for each parsed event batch */
  onEvents: (events: NomadEvent[]) => void;
  /** Optional signal to abort the stream */
  signal?: AbortSignal;
}

export interface NomadEvent {
  Topic: string;
  Type: string;
  Key: string;
  FilterKeys: Record<string, string[]> | null;
  Index: number;
  Payload: Record<string, unknown>;
}

/**
 * eventStream — long-polls /v1/event/stream, splitting NDJSON lines via
 * readline and calling onEvents for each heartbeat/batch. Reconnects
 * automatically on transient errors unless signal is aborted.
 */
export async function eventStream(cfg: NomadConfig, opts: EventStreamOptions): Promise<void> {
  const params: Record<string, string | number | boolean | undefined> = {
    namespace: opts.namespace ?? cfg.namespace,
    index: opts.index,
  };
  const qs = buildQueryString({}, params);
  // Append topic filters (repeating key)
  const topicStr = (opts.topics ?? []).map((t) => `topic=${encodeURIComponent(t)}`).join("&");
  const basePath = `event/stream${qs}${topicStr ? `&${topicStr}` : ""}`;

  const makeRequest = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (opts.signal?.aborted) { resolve(); return; }

      const urlStr = `${cfg.addr}/v1/${basePath}`;
      const parsed = new URL(urlStr);
      const reqModule = parsed.protocol === "https:" ? https : http;

      const reqOpts: http.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers: {
          ...(cfg.token ? { "X-Nomad-Token": cfg.token } : {}),
        },
      };

      let httpsAgent: https.Agent | undefined;
      if (parsed.protocol === "https:") {
        httpsAgent = new https.Agent({
          rejectUnauthorized: !cfg.tlsSkipVerify,
          ...(cfg.caCert ? { ca: fs.readFileSync(cfg.caCert) } : {}),
          ...(cfg.clientCert ? { cert: fs.readFileSync(cfg.clientCert) } : {}),
          ...(cfg.clientKey ? { key: fs.readFileSync(cfg.clientKey) } : {}),
        });
        (reqOpts as https.RequestOptions).agent = httpsAgent;
      }

      const req = reqModule.request(reqOpts, (res) => {
        if ((res.statusCode ?? 0) >= 400) {
          let body = "";
          res.on("data", (c: Buffer) => { body += c.toString(); });
          res.on("end", () => reject(new NomadApiError(`Event stream error ${res.statusCode ?? "?"}`, res.statusCode ?? 0, basePath, body)));
          return;
        }

        const rl = readline.createInterface({ input: res, crlfDelay: Infinity });
        rl.on("line", (line) => {
          if (!line.trim()) return; // heartbeat empty line
          try {
            const batch = JSON.parse(line) as { Events: NomadEvent[] | null };
            if (batch.Events?.length) opts.onEvents(batch.Events);
          } catch { /* malformed line — skip */ }
        });
        rl.on("close", () => resolve());
        rl.on("error", reject);
      });

      req.on("error", reject);

      opts.signal?.addEventListener("abort", () => {
        req.destroy();
        resolve();
      });

      req.end();
    });

  // Reconnect loop with backoff
  let backoff = 500;
  while (!opts.signal?.aborted) {
    try {
      await makeRequest();
      if (opts.signal?.aborted) break;
      backoff = 500; // reset on clean close
    } catch (err) {
      if (opts.signal?.aborted) break;
      process.stderr.write(`[event-stream] reconnecting in ${backoff}ms: ${err instanceof Error ? err.message : String(err)}\n`);
      await new Promise<void>((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Async Concurrency Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Run up to `concurrency` async tasks in parallel, collecting all results. */
export async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 8,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      const item = items[idx];
      if (item === undefined) continue;
      results[idx] = await fn(item, idx);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * batchAllocStatus — fetch allocation details for many alloc IDs concurrently.
 * Useful for dashboards and bulk health checks.
 */
export async function batchAllocStatus(
  cfg: NomadConfig,
  allocIds: string[],
  concurrency = 8,
): Promise<Array<{ id: string; alloc?: NomadAllocation; error?: string }>> {
  const client = new AllocationsClient(cfg);
  return pMap(allocIds, async (id) => {
    try {
      const resp = await client.read(id);
      return { id, alloc: resp.data };
    } catch (err) {
      return { id, error: err instanceof Error ? err.message : String(err) };
    }
  }, concurrency);
}

/**
 * watchDeployment — polls a deployment until it reaches a terminal state,
 * emitting status on each change via callback. Uses blocking queries.
 */
export async function watchDeployment(
  cfg: NomadConfig,
  deploymentId: string,
  onChange: (d: NomadDeployment) => void,
  timeoutMs = 600_000,
): Promise<NomadDeployment> {
  const client = new DeploymentsClient(cfg);
  let index = 0;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const resp = await client.read(deploymentId, { index, wait: "5m" });
    const d = resp.data;
    if (resp.meta?.index && resp.meta.index !== index) {
      index = resp.meta.index;
      onChange(d);
    }
    if (d.Status === "successful" || d.Status === "failed" || d.Status === "cancelled") {
      return d;
    }
  }
  throw new Error(`watchDeployment: timeout after ${timeoutMs}ms for deployment ${deploymentId}`);
}

/**
 * waitForJobAllocs — waits until all allocations for a job are running,
 * using blocking queries on the allocations list.
 */
export async function waitForJobAllocs(
  cfg: NomadConfig,
  jobId: string,
  desiredCount: number,
  timeoutMs = 300_000,
): Promise<NomadAllocation[]> {
  const client = new JobsClient(cfg);
  let index = 0;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const resp = await client.allocations(jobId, { index, wait: "5m" });
    const running = resp.data.filter((a) => a.ClientStatus === "running");
    if (resp.meta?.index) index = resp.meta.index;
    if (running.length >= desiredCount) return running;
  }
  throw new Error(`waitForJobAllocs: timeout after ${timeoutMs}ms for job ${jobId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery & Resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discovery handles mapping human-readable names or short prefixes to full UUIDs.
 * It is used by the CLI layer to make transactions more "fluid".
 */
export class Discovery {
  constructor(private cfg: NomadConfig) {}

  /** Resolves a Node ID or Name to a full 36-char UUID */
  async resolveNode(input: string, opts: QueryOptions = {}): Promise<string> {
    if (input.length === 36) return input;
    const client = new NodesClient(this.cfg);
    try {
      const resp = await client.read(input, opts);
      if (resp.data.ID) return resp.data.ID;
    } catch { /* ignore */ }

    const list = await client.list(opts);
    const match = list.data.find((n) => n.Name === input || n.ID.startsWith(input));
    if (!match) throw new Error(`Could not resolve Node ID or Name for: ${input}`);
    return match.ID;
  }

  /** Resolves a Volume ID to its managing PluginID and Namespace */
  async resolveCSI(volumeId: string, opts: QueryOptions = {}): Promise<{ PluginID: string; Namespace?: string }> {
    const client = new VolumesClient(this.cfg);
    try {
      const resp = await client.csiRead(volumeId, opts);
      if (resp.data.PluginID) return { PluginID: resp.data.PluginID, Namespace: resp.data.Namespace };
    } catch { /* ignore */ }

    // Fallback: search all namespaces
    const list = await client.list({ ...opts, namespace: "*", type: "csi" });
    const volumes = list.data as NomadCSIVolume[];
    const match = volumes.find((v) => v.ID === volumeId);
    if (!match) throw new Error(`Could not resolve CSI Volume ID for: ${volumeId}`);
    return { PluginID: match.PluginID!, Namespace: match.Namespace };
  }

  /** Resolves a Job ID prefix or Name to a full Job ID and its Namespace */
  async resolveJob(input: string, opts: QueryOptions = {}): Promise<{ ID: string; Namespace: string }> {
    const client = new JobsClient(this.cfg);
    // Try provided namespace or default
    try {
      const resp = await client.read(input, opts);
      if (resp.data.ID) return { ID: resp.data.ID, Namespace: resp.data.Namespace ?? "default" };
    } catch { /* ignore */ }

    // Fallback: search all namespaces
    const list = await client.list({ ...opts, namespace: "*" });
    const match = list.data.find((j) => j.ID === input || j.ID!.startsWith(input));
    if (!match) throw new Error(`Could not resolve Job ID or Name for: ${input}`);
    return { ID: match.ID!, Namespace: match.Namespace ?? "default" };
  }

  /** Resolves an Allocation ID prefix to a full UUID and its Namespace */
  async resolveAlloc(prefix: string, opts: QueryOptions = {}): Promise<{ ID: string; Namespace: string }> {
    if (prefix.length === 36) {
      const client = new AllocationsClient(this.cfg);
      const resp = await client.read(prefix, opts);
      return { ID: resp.data.ID, Namespace: resp.data.Namespace ?? "default" };
    }
    const client = new AllocationsClient(this.cfg);
    const list = await client.list({ ...opts, namespace: "*" });
    const match = list.data.find((a) => a.ID === prefix || a.ID.startsWith(prefix));
    if (!match) throw new Error(`Could not resolve Allocation ID for prefix: ${prefix}`);
    return { ID: match.ID, Namespace: match.Namespace ?? "default" };
  }
}

export interface NomadAllocHealth {
  ID: string;
  JobID: string;
  TaskGroup: string;
  NodeName: string;
  Status: string;
  LatestEvent: string;
  Restarts: number;
}

export interface NomadTopography {
  NodeName: string;
  NodeID: string;
  Datacenter: string;
  Pool: string;
  Status: string;
  Workloads: string;
  Attributes: string;
}

export interface NomadNodeInventory {
  Name: string;
  NodeClass: string;
  Address: string;
  OS: string;
  Kernel: string;
  Arch: string;
  Nomad: string;
  Consul: string;
}

/**
 * Diagnostic provides advanced, aggregated views of cluster health and structure.
 * These methods join data from multiple clients to reduce agent turn counts.
 */
export class Diagnostic {
  private jobs: JobsClient;
  private nodes: NodesClient;
  private allocs: AllocationsClient;

  constructor(cfg: NomadConfig) {
    this.jobs = new JobsClient(cfg);
    this.nodes = new NodesClient(cfg);
    this.allocs = new AllocationsClient(cfg);
  }

  /** Aggregates allocation status with high-signal task event data */
  async allocHealth(opts: QueryOptions = {}): Promise<ApiResponse<NomadAllocHealth[]>> {
    const allocs = await this.allocs.list(opts);

    const health: NomadAllocHealth[] = allocs.data.map((a) => {
      let latestEvent = "No events";
      let restarts = 0;

      if (a.TaskStates) {
        for (const ts of Object.values(a.TaskStates)) {
          restarts += ts.Restarts ?? 0;
          if (ts.Events && ts.Events.length > 0) {
            const ev = ts.Events[0];
            if (!ev) continue;
            const type = ev["Type"];
            const msg = ev["DisplayMessage"];
            if (typeof type === "string") latestEvent = type;
            else if (typeof msg === "string") latestEvent = msg;
          }
        }
      }

      return {
        ID: a.ID.slice(0, 8),
        JobID: a.JobID || "unknown",
        TaskGroup: a.TaskGroup || "unknown",
        NodeName: a.NodeName || "unknown",
        Status: a.ClientStatus || "unknown",
        LatestEvent: latestEvent,
        Restarts: restarts,
      };
    });

    return { data: health, statusCode: 200 };
  }

  /** Maps nodes to their hosted workloads and metadata/attributes */
  async topography(opts: QueryOptions = {}): Promise<ApiResponse<NomadTopography[]>> {
    const nodes = await this.nodes.list(opts);
    const allocs = await this.allocs.list({ ...opts, filter: 'ClientStatus == "running"' });

    const topo: NomadTopography[] = nodes.data.map((n) => {
      const nodeAllocs = allocs.data.filter((a) => a.NodeID === n.ID);
      const jobs = [...new Set(nodeAllocs.map((a) => a.JobID))].join(", ");

      const attrList = [];
      if (n.Attributes?.["cpu.modelname"]) attrList.push(n.Attributes["cpu.modelname"]);
      if (n.Attributes?.["os.name"]) attrList.push(n.Attributes["os.name"]);
      if (n.Meta?.["owner"]) attrList.push(`owner:${n.Meta["owner"]}`);

      return {
        NodeName: n.Name || "unknown",
        NodeID: n.ID.slice(0, 8),
        Datacenter: n.Datacenter || "unknown",
        Pool: n.NodePool || "default",
        Status: n.Status || "unknown",
        Workloads: jobs || "(none)",
        Attributes: attrList.join(" | "),
      };
    });

    return { data: topo, statusCode: 200 };
  }

  /** Unified cluster dashboard: Allocated vs Real-time */
  async dashboard(opts: QueryOptions = {}): Promise<ApiResponse<unknown[]>> {
    const usageResp = await this.nodes.usage(opts);
    const statsResp = await this.nodes.stats(opts);

    const dashboard = usageResp.data.map((u) => {
      const s = statsResp.data.find((stat) => stat.Name === u.Name);
      return {
        ...u,
        RealtimeCPU: s?.CPUTicks,
        RealtimeMem: s?.MemoryUsed,
      };
    });

    return { data: dashboard, statusCode: 200 };
  }

  /** Cluster inventory: OS, Kernel, IP, Versions */
  async inventory(opts: QueryOptions = {}): Promise<ApiResponse<NomadNodeInventory[]>> {
    const nodes = await this.nodes.list(opts);

    // Fetch full details for all nodes to get Attributes
    const fullNodes = await pMap(nodes.data, async (n) => {
      try {
        const full = await this.nodes.read(n.ID, opts);
        return full.data;
      } catch { return n; }
    }, 10);

    const inventory: NomadNodeInventory[] = fullNodes.map((n) => ({
      Name: n.Name || "unknown",
      NodeClass: n.NodeClass || "-",
      Address: n.Attributes?.["unique.network.ip-address"] || n.HTTPAddr || "unknown",
      OS: `${n.Attributes?.["os.name"] || "unknown"} ${n.Attributes?.["os.version"] || ""}`.trim(),
      Kernel: n.Attributes?.["kernel.version"] || "unknown",
      Arch: n.Attributes?.["cpu.arch"] || "unknown",
      Nomad: n.Attributes?.["nomad.version"] || "unknown",
      Consul: n.Attributes?.["consul.version"] || "not running",
    }));

    return { data: inventory, statusCode: 200 };
  }

  /** Executive summary of total cluster state */
  async summary(opts: QueryOptions = {}): Promise<ApiResponse<Record<string, unknown>>> {
    const [jobs, nodes, allocs] = await Promise.all([
      this.jobs.list(opts),
      this.nodes.list(opts),
      this.allocs.list(opts),
    ]);

    return {
      data: {
        Jobs: {
          Total: jobs.data.length,
          Running: jobs.data.filter((j) => j.Status === "running").length,
          Dead: jobs.data.filter((j) => j.Status === "dead").length,
        },
        Nodes: {
          Total: nodes.data.length,
          Ready: nodes.data.filter((n) => n.Status === "ready").length,
          Eligible: nodes.data.filter((n) => n.SchedulingEligibility === "eligible").length,
        },
        Allocations: {
          Total: allocs.data.length,
          Running: allocs.data.filter((a) => a.ClientStatus === "running").length,
          Failed: allocs.data.filter((a) => a.ClientStatus === "failed").length,
        },
      },
      statusCode: 200,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resource Clients
// ─────────────────────────────────────────────────────────────────────────────

export class JobsClient {
  constructor(private cfg: NomadConfig) {}

  async list(opts: QueryOptions & { prefix?: string } = {}): Promise<ApiResponse<NomadJob[]>> {
    return nomadRequest<NomadJob[]>(this.cfg, "GET", "jobs", undefined, opts);
  }

  async register(req: NomadJobSubmitRequest, opts: QueryOptions = {}): Promise<ApiResponse<NomadJobRegisterResponse>> {
    return nomadRequest<NomadJobRegisterResponse>(this.cfg, "POST", "jobs", req, opts);
  }

  async parse(jobHcl: string, canonicalize = false): Promise<ApiResponse<NomadJob>> {
    return nomadRequest<NomadJob>(this.cfg, "POST", "jobs/parse", { JobHCL: jobHcl, Canonicalize: canonicalize });
  }

  async read(jobId: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadJob>> {
    return nomadRequest<NomadJob>(this.cfg, "GET", `job/${encodeURIComponent(jobId)}`, undefined, opts);
  }

  async submission(jobId: string, version?: number, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    const extra = version !== undefined ? { version: String(version) } : undefined;
    return nomadRequest(this.cfg, "GET", `job/${encodeURIComponent(jobId)}/submission`, undefined, { ...opts, ...(extra && { filter: undefined }) });
  }

  async versions(jobId: string, diffs = false, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", `job/${encodeURIComponent(jobId)}/versions`, undefined, opts, {
      diffs: diffs || undefined,
    });
  }

  async allocations(jobId: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadAllocation[]>> {
    return nomadRequest<NomadAllocation[]>(this.cfg, "GET", `job/${encodeURIComponent(jobId)}/allocations`, undefined, opts);
  }

  async evaluations(jobId: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadEvaluation[]>> {
    return nomadRequest<NomadEvaluation[]>(this.cfg, "GET", `job/${encodeURIComponent(jobId)}/evaluations`, undefined, opts);
  }

  async deployments(jobId: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadDeployment[]>> {
    return nomadRequest<NomadDeployment[]>(this.cfg, "GET", `job/${encodeURIComponent(jobId)}/deployments`, undefined, opts);
  }

  async currentDeployment(jobId: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadDeployment>> {
    return nomadRequest<NomadDeployment>(this.cfg, "GET", `job/${encodeURIComponent(jobId)}/deployment`, undefined, opts);
  }

  async summary(jobId: string, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", `job/${encodeURIComponent(jobId)}/summary`, undefined, opts);
  }

  async update(jobId: string, req: NomadJobSubmitRequest, opts: QueryOptions = {}): Promise<ApiResponse<NomadJobRegisterResponse>> {
    return nomadRequest<NomadJobRegisterResponse>(this.cfg, "POST", `job/${encodeURIComponent(jobId)}`, req, opts);
  }

  async dispatch(
    jobId: string,
    payload?: { Meta?: Record<string, string>; Payload?: string },
    opts: QueryOptions = {}
  ): Promise<ApiResponse<{ EvalID: string; DispatchedJobID: string; Index: number }>> {
    return nomadRequest(this.cfg, "POST", `job/${encodeURIComponent(jobId)}/dispatch`, payload ?? {}, opts);
  }

  async revert(jobId: string, jobVersion: number, enforcePriorVersion?: number, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `job/${encodeURIComponent(jobId)}/revert`, {
      JobID: jobId,
      JobVersion: jobVersion,
      EnforcePriorVersion: enforcePriorVersion,
    }, opts);
  }

  async markStable(jobId: string, jobVersion: number, stable: boolean, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `job/${encodeURIComponent(jobId)}/stable`, {
      JobID: jobId,
      JobVersion: jobVersion,
      Stable: stable,
    }, opts);
  }

  async evaluate(jobId: string, opts: QueryOptions = {}): Promise<ApiResponse<{ EvalID: string; EvalCreateIndex: number; Index: number }>> {
    return nomadRequest(this.cfg, "POST", `job/${encodeURIComponent(jobId)}/evaluate`, {}, opts);
  }

  async plan(jobId: string, req: NomadJobSubmitRequest, diffOutput = true, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `job/${encodeURIComponent(jobId)}/plan`, { ...req, Diff: diffOutput }, opts);
  }

  async periodicForce(jobId: string, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `job/${encodeURIComponent(jobId)}/periodic/force`, {}, opts);
  }

  async getScale(jobId: string, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", `job/${encodeURIComponent(jobId)}/scale`, undefined, opts);
  }

  async scale(
    jobId: string,
    req: { Target: Record<string, string>; Count?: number; Message?: string; Meta?: Record<string, string>; PolicyOverride?: boolean; Error?: boolean },
    opts: QueryOptions = {}
  ): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `job/${encodeURIComponent(jobId)}/scale`, req, opts);
  }

  async services(jobId: string, opts: QueryOptions = {}): Promise<ApiResponse<unknown[]>> {
    return nomadRequest(this.cfg, "GET", `job/${encodeURIComponent(jobId)}/services`, undefined, opts);
  }

  async actions(jobId: string, opts: QueryOptions = {}): Promise<ApiResponse<unknown[]>> {
    return nomadRequest(this.cfg, "GET", `job/${encodeURIComponent(jobId)}/actions`, undefined, opts);
  }

  async tagVersion(jobId: string, tagName: string, req: { Version: number; Description?: string }, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `job/${encodeURIComponent(jobId)}/versions/${encodeURIComponent(tagName)}/tag`, req, opts);
  }

  async untagVersion(jobId: string, tagName: string, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "DELETE", `job/${encodeURIComponent(jobId)}/versions/${encodeURIComponent(tagName)}/tag`, undefined, opts);
  }

  async stop(jobId: string, purge = false, global = false, opts: QueryOptions = {}): Promise<ApiResponse<{ EvalID: string; Index: number }>> {
    return nomadRequest(this.cfg, "DELETE", `job/${encodeURIComponent(jobId)}`, undefined, opts, {
      purge: purge ? "true" : undefined,
      global: global ? "true" : undefined,
    });
  }
}

export class AllocationsClient {
  constructor(private cfg: NomadConfig) {}

  async list(opts: QueryOptions = {}): Promise<ApiResponse<NomadAllocation[]>> {
    return nomadRequest<NomadAllocation[]>(this.cfg, "GET", "allocations", undefined, opts);
  }

  async read(allocId: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadAllocation>> {
    return nomadRequest<NomadAllocation>(this.cfg, "GET", `allocation/${encodeURIComponent(allocId)}`, undefined, opts);
  }

  async checks(allocId: string, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", `allocation/${encodeURIComponent(allocId)}/checks`, undefined, opts);
  }

  async services(allocId: string, opts: QueryOptions = {}): Promise<ApiResponse<unknown[]>> {
    return nomadRequest(this.cfg, "GET", `allocation/${encodeURIComponent(allocId)}/services`, undefined, opts);
  }

  async stop(allocId: string, noShutdownDelay = false, opts: QueryOptions = {}): Promise<ApiResponse<{ EvalID: string; Index: number }>> {
    return nomadRequest(this.cfg, "POST", `allocation/${encodeURIComponent(allocId)}/stop`, undefined, opts, {
      no_shutdown_delay: noShutdownDelay || undefined,
    });
  }
}

export class ClientClient {
  constructor(private cfg: NomadConfig) {}

  async stats(nodeId?: string): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", "client/stats", undefined, {}, {
      node_id: nodeId,
    });
  }

  async allocStats(allocId: string, task?: string): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", `client/allocation/${encodeURIComponent(allocId)}/stats`, undefined, {}, {
      task,
    });
  }

  async allocGC(allocId: string): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "GET", `client/allocation/${encodeURIComponent(allocId)}/gc`);
  }

  async allocPause(allocId: string, action: "pause" | "resume"): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", `client/allocation/${encodeURIComponent(allocId)}/pause`, undefined, {}, {
      action,
    });
  }

  async allocRestart(allocId: string, task?: string, allTasks = false): Promise<ApiResponse<unknown>> {
    const body: Record<string, unknown> = {};
    if (task) body["TaskName"] = task;
    if (allTasks) body["AllTasks"] = true;
    return nomadRequest(this.cfg, "POST", `client/allocation/${encodeURIComponent(allocId)}/restart`, body);
  }

  async allocSignal(allocId: string, signal: string, task?: string): Promise<ApiResponse<unknown>> {
    const body: Record<string, unknown> = { Signal: signal };
    if (task) body["Task"] = task;
    return nomadRequest(this.cfg, "POST", `client/allocation/${encodeURIComponent(allocId)}/signal`, body);
  }

  async fsList(allocId: string, filePath = "/", opts?: { task?: string }): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", `client/fs/ls/${encodeURIComponent(allocId)}`, undefined, {}, {
      path: filePath,
      task: opts?.task,
    });
  }

  async fsStat(allocId: string, filePath: string, opts?: { task?: string }): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", `client/fs/stat/${encodeURIComponent(allocId)}`, undefined, {}, {
      path: filePath,
      task: opts?.task,
    });
  }

  async fsCat(allocId: string, filePath: string, opts?: { task?: string }): Promise<ApiResponse<string>> {
    return nomadRequest(this.cfg, "GET", `client/fs/cat/${encodeURIComponent(allocId)}`, undefined, {}, {
      path: filePath,
      task: opts?.task,
    });
  }

  async fsReadAt(allocId: string, filePath: string, offset: number, limit: number, opts?: { task?: string }): Promise<ApiResponse<string>> {
    return nomadRequest(this.cfg, "GET", `client/fs/readat/${encodeURIComponent(allocId)}`, undefined, {}, {
      path: filePath,
      offset,
      limit,
      task: opts?.task,
    });
  }

  /** Streams logs from the task. Returns a chunked stream via callback. */
  async streamLogs(
    allocId: string,
    task: string,
    logType: "stdout" | "stderr" = "stdout",
    opts: { follow?: boolean; tail?: number; origin?: "start" | "end"; offset?: number } = {}
  ): Promise<void> {
    const config = this.cfg;
    const qs = new URLSearchParams({
      task,
      type: logType,
      follow: opts.follow === false ? "false" : "true",
      origin: opts.origin ?? "end",
    });
    if (opts.tail !== undefined) qs.set("offset", String(opts.tail));
    if (opts.offset !== undefined) qs.set("offset", String(opts.offset));

    const url = `${config.addr}/v1/client/fs/logs/${encodeURIComponent(allocId)}?${qs.toString()}`;
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";

    const headers: Record<string, string> = {};
    if (config.token) headers["X-Nomad-Token"] = config.token;

    await new Promise<void>((resolve, reject) => {
      const reqOpts = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: "GET",
        headers,
        ...(config.tlsSkipVerify && { rejectUnauthorized: false }),
      };
      const transport = isHttps ? https : http;
      const req = transport.request(reqOpts, (res) => {
        res.on("data", (chunk: Buffer) => {
          try {
            const lines = chunk.toString("utf8").split("\n").filter((l) => l.trim());
            for (const line of lines) {
              const msg = JSON.parse(line) as { Data?: string; FileEvent?: string };
              if (msg.Data) {
                process.stdout.write(Buffer.from(msg.Data, "base64").toString("utf8"));
              }
            }
          } catch { /* partial chunk */ }
        });
        res.on("end", resolve);
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    });
  }

  async gc(): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "GET", "client/gc");
  }

  async identity(): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", "client/identity");
  }

  async identityRenew(): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", "client/identity/renew");
  }

  async metadata(): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", "client/metadata");
  }
}

export interface NomadNodeStats {
  ID: string;
  Name: string;
  CPUTicks: number;
  MemoryUsed: number;
  MemoryTotal: number;
  MemoryPercent: string;
}

export interface NomadNodeStatsResponse {
  CPUTicksConsumed: number;
  Memory: { Used: number; Total: number };
}

export interface NomadNodeUsage {
  ID: string;
  Name: string;
  Status: string;
  Eligibility: string;
  AllocatedCPU: number;
  TotalCPU: number;
  CPUPercent: string;
  AllocatedMem: number;
  TotalMem: number;
  MemPercent: string;
  Volumes: number;
  Specialty: string;
  Meta: string;
  RealtimeCPU?: number;
  RealtimeMem?: number;
}

export class NodesClient {
  constructor(private cfg: NomadConfig) {}

  async usage(opts: QueryOptions = {}): Promise<ApiResponse<NomadNodeUsage[]>> {
    const nodesResp = await this.list(opts);
    const allocsResp = await nomadRequest<NomadAllocation[]>(this.cfg, "GET", "allocations", undefined, { ...opts, filter: 'ClientStatus == "running"' });

    // Node list doesn't have resources, we need to fetch them or assume 0.
    // To be efficient and accurate, we fetch the node details in parallel.
    const nodesWithResources = await pMap(nodesResp.data, async (n) => {
      try {
        const full = await this.read(n.ID, opts);
        return full.data;
      } catch { return n; }
    }, 10);

    const usage: NomadNodeUsage[] = nodesWithResources.map((node) => {
      const nodeAllocs = allocsResp.data.filter((a) => a.NodeID === node.ID);
      // Fallback to Resources if AllocatedResources is missing (common in list views)
      const allocatedCpu = nodeAllocs.reduce((sum, a) => {
        const shares = a.AllocatedResources?.Shared?.CpuShares ?? a.Resources?.CPU ?? 0;
        return sum + shares;
      }, 0);
      const allocatedMem = nodeAllocs.reduce((sum, a) => {
        const mb = a.AllocatedResources?.Shared?.MemoryMB ?? a.Resources?.MemoryMB ?? 0;
        return sum + mb;
      }, 0);

      const totalCpu = node.NodeResources?.Cpu?.CpuShares ?? 0;
      const totalMem = node.NodeResources?.Memory?.MemoryMB ?? 0;

      // Stateful & Specialty detection
      const volCount = Object.keys(node.HostVolumes ?? {}).length + Object.keys(node.CSINodePlugins ?? {}).length;
      
      const special: string[] = [];
      if (node.Drivers) {
        for (const [name, d] of Object.entries(node.Drivers)) {
          if (d.Healthy && (name.includes("nvidia") || name.includes("gpu"))) special.push("gpu");
        }
      }
      if (node.CSINodePlugins) {
        for (const name of Object.keys(node.CSINodePlugins)) {
          special.push(name.replace("ceph-csi-", "ceph:"));
        }
      }

      const metaSummary = Object.entries(node.Meta ?? {})
        .filter(([k]) => ["env", "tier", "owner", "role"].includes(k.toLowerCase()))
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");

      return {
        ID: node.ID.slice(0, 8),
        Name: node.Name ?? "unknown",
        Status: node.Status ?? "unknown",
        Eligibility: node.SchedulingEligibility ?? "unknown",
        AllocatedCPU: allocatedCpu,
        TotalCPU: totalCpu,
        CPUPercent: totalCpu > 0 ? `${((allocatedCpu / totalCpu) * 100).toFixed(1)}%` : "0%",
        AllocatedMem: allocatedMem,
        TotalMem: totalMem,
        MemPercent: totalMem > 0 ? `${((allocatedMem / totalMem) * 100).toFixed(1)}%` : "0%",
        Volumes: volCount,
        Specialty: special.join(", ") || "general",
        Meta: metaSummary || "-",
      };
    });

    return { data: usage, statusCode: 200 };
  }

  async stats(opts: QueryOptions = {}): Promise<ApiResponse<NomadNodeStats[]>> {
    const nodes = await this.list(opts);
    const client = new ClientClient(this.cfg);

    const results = await pMap(nodes.data, async (node) => {
      try {
        const s = await client.stats(node.ID);
        const data = s.data as NomadNodeStatsResponse;
        const mem = data.Memory;
        return {
          ID: node.ID.slice(0, 8),
          Name: node.Name || "unknown",
          CPUTicks: Math.round(data.CPUTicksConsumed || 0),
          MemoryUsed: Math.round((mem.Used || 0) / 1024 / 1024),
          MemoryTotal: Math.round((mem.Total || 0) / 1024 / 1024),
          MemoryPercent: `${((mem.Used / mem.Total) * 100).toFixed(1)}%`,
        };
      } catch {
        return { ID: node.ID.slice(0, 8), Name: node.Name || "unknown", CPUTicks: 0, MemoryUsed: 0, MemoryTotal: 0, MemoryPercent: "Error" };
      }
    }, 8);

    return { data: results, statusCode: 200 };
  }

  async list(opts: QueryOptions = {}): Promise<ApiResponse<NomadNode[]>> {
    return nomadRequest<NomadNode[]>(this.cfg, "GET", "nodes", undefined, opts);
  }

  async read(nodeId: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadNode>> {
    return nomadRequest<NomadNode>(this.cfg, "GET", `node/${encodeURIComponent(nodeId)}`, undefined, opts);
  }

  async allocations(nodeId: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadAllocation[]>> {
    return nomadRequest<NomadAllocation[]>(this.cfg, "GET", `node/${encodeURIComponent(nodeId)}/allocations`, undefined, opts);
  }

  async evaluate(nodeId: string): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `node/${encodeURIComponent(nodeId)}/evaluate`, {});
  }

  async drain(
    nodeId: string,
    req: {
      DrainSpec?: { Deadline?: number; IgnoreSystemJobs?: boolean };
      MarkEligible?: boolean;
      Meta?: Record<string, string>;
    },
    opts: QueryOptions = {}
  ): Promise<ApiResponse<unknown>> {
    const fullId = await new Discovery(this.cfg).resolveNode(nodeId, opts);
    const body = { ...req, NodeID: fullId };
    return nomadRequest(this.cfg, "POST", `node/${encodeURIComponent(fullId)}/drain`, body, opts);
  }

  async purge(nodeId: string, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    const fullId = await new Discovery(this.cfg).resolveNode(nodeId, opts);
    return nomadRequest(this.cfg, "POST", `node/${encodeURIComponent(fullId)}/purge`, {}, opts);
  }

  async eligibility(nodeId: string, eligible: boolean, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    const fullId = await new Discovery(this.cfg).resolveNode(nodeId, opts);
    return nomadRequest(this.cfg, "POST", `node/${encodeURIComponent(fullId)}/eligibility`, {
      NodeID: fullId,
      Eligibility: eligible ? "eligible" : "ineligible",
    }, opts);
  }
}

export class DeploymentsClient {
  constructor(private cfg: NomadConfig) {}

  async list(opts: QueryOptions = {}): Promise<ApiResponse<NomadDeployment[]>> {
    return nomadRequest<NomadDeployment[]>(this.cfg, "GET", "deployments", undefined, opts);
  }

  async read(deploymentId: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadDeployment>> {
    return nomadRequest<NomadDeployment>(this.cfg, "GET", `deployment/${encodeURIComponent(deploymentId)}`, undefined, opts);
  }

  async allocations(deploymentId: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadAllocation[]>> {
    return nomadRequest<NomadAllocation[]>(this.cfg, "GET", `deployment/allocations/${encodeURIComponent(deploymentId)}`, undefined, opts);
  }

  async fail(deploymentId: string): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `deployment/fail/${encodeURIComponent(deploymentId)}`, {});
  }

  async pause(deploymentId: string, pause: boolean): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `deployment/pause/${encodeURIComponent(deploymentId)}`, {
      DeploymentID: deploymentId,
      Pause: pause,
    });
  }

  async promote(deploymentId: string, groups?: string[], all = false): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `deployment/promote/${encodeURIComponent(deploymentId)}`, {
      DeploymentID: deploymentId,
      All: all,
      Groups: groups,
    });
  }

  async allocHealth(
    deploymentId: string,
    req: { HealthyAllocationIDs?: string[]; UnhealthyAllocationIDs?: string[] }
  ): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `deployment/allocation-health/${encodeURIComponent(deploymentId)}`, req);
  }

  async unblock(deploymentId: string): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `deployment/unblock/${encodeURIComponent(deploymentId)}`, {});
  }
}

export class EvaluationsClient {
  constructor(private cfg: NomadConfig) {}

  async list(opts: QueryOptions = {}): Promise<ApiResponse<NomadEvaluation[]>> {
    return nomadRequest<NomadEvaluation[]>(this.cfg, "GET", "evaluations", undefined, opts);
  }

  async count(opts: QueryOptions = {}): Promise<ApiResponse<{ Count: number }>> {
    return nomadRequest(this.cfg, "GET", "evaluations/count", undefined, opts);
  }

  async read(evalId: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadEvaluation>> {
    return nomadRequest<NomadEvaluation>(this.cfg, "GET", `evaluation/${encodeURIComponent(evalId)}`, undefined, opts);
  }

  async allocations(evalId: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadAllocation[]>> {
    return nomadRequest<NomadAllocation[]>(this.cfg, "GET", `evaluation/${encodeURIComponent(evalId)}/allocations`, undefined, opts);
  }

  async delete(evalIds: string[]): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "DELETE", "evaluations", { EvalIDs: evalIds });
  }
}

export class VolumesClient {
  constructor(private cfg: NomadConfig) {}

  async list(opts: QueryOptions & { type?: "csi" | "host"; pluginId?: string; nodeId?: string } = {}): Promise<ApiResponse<unknown[]>> {
    const { type, pluginId, nodeId, ...qopts } = opts;
    return nomadRequest(this.cfg, "GET", "volumes", undefined, qopts, {
      ...(type     !== undefined ? { type }              : {}),
      ...(pluginId !== undefined ? { plugin_id: pluginId } : {}),
      ...(nodeId   !== undefined ? { node_id:   nodeId }   : {}),
    });
  }

  // CSI
  async csiRead(volumeId: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadCSIVolume>> {
    return nomadRequest<NomadCSIVolume>(this.cfg, "GET", `volume/csi/${encodeURIComponent(volumeId)}`, undefined, opts);
  }

  async csiRegister(volumeId: string, req: unknown, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    const body = (req && typeof req === "object" && "Volumes" in req) ? req : { Volumes: [req] };
    return nomadRequest(this.cfg, "PUT", `volume/csi/${encodeURIComponent(volumeId)}`, body, opts);
  }

  async csiCreate(volumeId: string, req: unknown, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    const body = (req && typeof req === "object" && "Volumes" in req) ? req : { Volumes: [req] };
    return nomadRequest(this.cfg, "PUT", `volume/csi/${encodeURIComponent(volumeId)}/create`, body, opts);
  }

  async csiDeregister(volumeId: string, force = false, opts: QueryOptions = {}): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "DELETE", `volume/csi/${encodeURIComponent(volumeId)}`, undefined, opts, {
      force: force || undefined,
    });
  }

  async csiDelete(volumeId: string, secrets?: Record<string, string>, opts: QueryOptions = {}): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "DELETE", `volume/csi/${encodeURIComponent(volumeId)}/delete`, undefined, opts, undefined, secrets);
  }

  async csiDetach(volumeId: string, nodeId: string, opts: QueryOptions = {}): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "DELETE", `volume/csi/${encodeURIComponent(volumeId)}/detach`, undefined, opts, {
      node: nodeId,
    });
  }

  async listExternal(pluginId: string, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    try {
      return await nomadRequest(this.cfg, "GET", "volumes/external", undefined, opts, {
        plugin_id: pluginId,
      });
    } catch (err) {
      if (err instanceof NomadApiError && err.statusCode === 500 && (err.body?.includes("unimplemented") || err.body?.includes("not support"))) {
        return {
          data: {
            Warning: `Plugin '${pluginId}' does not support listing external volumes via the Nomad API.`,
            Note: "This is a common limitation of some CSI plugins (e.g. Ceph).",
            Volumes: [],
          },
          statusCode: 200,
        };
      }
      throw err;
    }
  }

  async listSnapshots(pluginId: string, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    try {
      return await nomadRequest(this.cfg, "GET", "volumes/snapshot", undefined, opts, {
        plugin_id: pluginId,
      });
    } catch (err) {
      if (err instanceof NomadApiError && err.statusCode === 500 && (err.body?.includes("unimplemented") || err.body?.includes("not support"))) {
        return {
          data: {
            Warning: `Plugin '${pluginId}' does not support listing snapshots via the Nomad API.`,
            Note: "Snapshots created via 'snapshot-create' may still be successful. Trust the 'accepted' message and check your storage backend.",
            Snapshots: [],
          },
          statusCode: 200,
        };
      }
      throw err;
    }
  }

  async createSnapshot(req: { PluginID: string; Snapshot?: { VolumeID: string; Name: string; Secrets?: Record<string, string>; Parameters?: Record<string, string> } }, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "PUT", "volumes/snapshot", req, opts, undefined, req.Snapshot?.Secrets);
  }

  async deleteSnapshot(pluginId: string, snapshotId: string, opts: QueryOptions = {}, secrets?: Record<string, string>): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "DELETE", "volumes/snapshot", undefined, opts, {
      plugin_id: pluginId,
      snapshot_id: snapshotId,
    }, secrets);
  }

  async deleteClaim(claimId: string, opts: QueryOptions = {}): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "DELETE", `volumes/claim/${encodeURIComponent(claimId)}`, undefined, opts);
  }

  // Dynamic Host
  async hostRead(volumeId: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadHostVolume>> {
    return nomadRequest<NomadHostVolume>(this.cfg, "GET", `volume/host/${encodeURIComponent(volumeId)}`, undefined, opts);
  }

  async hostRegister(volumeId: string, req: NomadHostVolume, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "PUT", `volume/host/${encodeURIComponent(volumeId)}`, req, opts);
  }

  async hostCreate(volumeId: string, req: NomadHostVolume, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "PUT", `volume/host/${encodeURIComponent(volumeId)}/create`, req, opts);
  }

  async hostDelete(volumeId: string, opts: QueryOptions = {}): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "DELETE", `volume/host/${encodeURIComponent(volumeId)}/delete`, undefined, opts);
  }
}

export class PluginsClient {
  constructor(private cfg: NomadConfig) {}

  async list(opts: QueryOptions = {}): Promise<ApiResponse<unknown[]>> {
    return nomadRequest(this.cfg, "GET", "plugins", undefined, opts);
  }

  async readCSI(pluginId: string, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", `plugin/csi/${encodeURIComponent(pluginId)}`, undefined, opts);
  }
}

export class ServicesClient {
  constructor(private cfg: NomadConfig) {}

  async list(opts: QueryOptions = {}): Promise<ApiResponse<unknown[]>> {
    return nomadRequest(this.cfg, "GET", "services", undefined, opts);
  }

  async read(serviceName: string, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", `service/${encodeURIComponent(serviceName)}`, undefined, opts);
  }

  async delete(serviceName: string, serviceId: string, opts: QueryOptions = {}): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "DELETE", `service/${encodeURIComponent(serviceName)}/${encodeURIComponent(serviceId)}`, undefined, opts);
  }
}

export class VariablesClient {
  constructor(private cfg: NomadConfig) {}

  async list(prefix?: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadVariable[]>> {
    return nomadRequest<NomadVariable[]>(this.cfg, "GET", "vars", undefined, { ...opts, prefix });
  }

  async read(varPath: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadVariable>> {
    return nomadRequest<NomadVariable>(this.cfg, "GET", `var/${encodeURIComponent(varPath)}`, undefined, opts);
  }

  async write(varPath: string, variable: NomadVariable, cas?: number, opts: QueryOptions = {}): Promise<ApiResponse<NomadVariable>> {
    return nomadRequest<NomadVariable>(this.cfg, "PUT", `var/${encodeURIComponent(varPath)}`, variable, opts, {
      cas,
    });
  }

  async delete(varPath: string, cas?: number, opts: QueryOptions = {}): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "DELETE", `var/${encodeURIComponent(varPath)}`, undefined, opts, {
      cas,
    });
  }

  async lockAcquire(varPath: string, variable: NomadVariable, opts: QueryOptions = {}): Promise<ApiResponse<NomadVariable>> {
    return nomadRequest<NomadVariable>(this.cfg, "PUT", `var/${encodeURIComponent(varPath)}`, variable, opts, {
      "lock-acquire": "",
    });
  }

  async lockRenew(varPath: string, variable: NomadVariable, opts: QueryOptions = {}): Promise<ApiResponse<NomadVariable>> {
    return nomadRequest<NomadVariable>(this.cfg, "PUT", `var/${encodeURIComponent(varPath)}`, variable, opts, {
      "lock-renew": "",
    });
  }

  async lockRelease(varPath: string, variable: NomadVariable, opts: QueryOptions = {}): Promise<ApiResponse<NomadVariable>> {
    return nomadRequest<NomadVariable>(this.cfg, "PUT", `var/${encodeURIComponent(varPath)}`, variable, opts, {
      "lock-release": "",
    });
  }
}

export class NamespacesClient {
  constructor(private cfg: NomadConfig) {}

  async list(opts: QueryOptions = {}): Promise<ApiResponse<NomadNamespace[]>> {
    return nomadRequest<NomadNamespace[]>(this.cfg, "GET", "namespaces", undefined, opts);
  }

  async read(name: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadNamespace>> {
    return nomadRequest<NomadNamespace>(this.cfg, "GET", `namespace/${encodeURIComponent(name)}`, undefined, opts);
  }

  async write(name: string, ns: NomadNamespace): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `namespace/${encodeURIComponent(name)}`, ns);
  }

  async delete(name: string): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "DELETE", `namespace/${encodeURIComponent(name)}`);
  }
}

export class NodePoolsClient {
  constructor(private cfg: NomadConfig) {}

  async list(opts: QueryOptions = {}): Promise<ApiResponse<NomadNodePool[]>> {
    return nomadRequest<NomadNodePool[]>(this.cfg, "GET", "node/pools", undefined, opts);
  }

  async read(name: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadNodePool>> {
    return nomadRequest<NomadNodePool>(this.cfg, "GET", `node/pool/${encodeURIComponent(name)}`, undefined, opts);
  }

  async write(name: string, pool: NomadNodePool): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `node/pool/${encodeURIComponent(name)}`, pool);
  }

  async delete(name: string): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "DELETE", `node/pool/${encodeURIComponent(name)}`);
  }

  async nodes(name: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadNode[]>> {
    return nomadRequest<NomadNode[]>(this.cfg, "GET", `node/pool/${encodeURIComponent(name)}/nodes`, undefined, opts);
  }

  async jobs(name: string, opts: QueryOptions = {}): Promise<ApiResponse<NomadJob[]>> {
    return nomadRequest<NomadJob[]>(this.cfg, "GET", `node/pool/${encodeURIComponent(name)}/jobs`, undefined, opts);
  }
}

export class ACLClient {
  constructor(private cfg: NomadConfig) {}

  // Tokens
  async bootstrap(bootstrapSecret?: string): Promise<ApiResponse<NomadACLToken>> {
    return nomadRequest<NomadACLToken>(this.cfg, "POST", "acl/bootstrap", bootstrapSecret ? { BootstrapSecret: bootstrapSecret } : undefined);
  }
  async listTokens(opts: QueryOptions = {}): Promise<ApiResponse<NomadACLToken[]>> {
    return nomadRequest<NomadACLToken[]>(this.cfg, "GET", "acl/tokens", undefined, opts);
  }
  async createToken(req: NomadACLToken): Promise<ApiResponse<NomadACLToken>> {
    return nomadRequest<NomadACLToken>(this.cfg, "POST", "acl/token", req);
  }
  async updateToken(accessorId: string, req: NomadACLToken): Promise<ApiResponse<NomadACLToken>> {
    return nomadRequest<NomadACLToken>(this.cfg, "POST", `acl/token/${encodeURIComponent(accessorId)}`, req);
  }
  async readToken(accessorId: string): Promise<ApiResponse<NomadACLToken>> {
    return nomadRequest<NomadACLToken>(this.cfg, "GET", `acl/token/${encodeURIComponent(accessorId)}`);
  }
  async selfToken(): Promise<ApiResponse<NomadACLToken>> {
    return nomadRequest<NomadACLToken>(this.cfg, "GET", "acl/token/self");
  }
  async deleteToken(accessorId: string): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "DELETE", `acl/token/${encodeURIComponent(accessorId)}`);
  }
  async oneTimeToken(): Promise<ApiResponse<{ OneTimeToken: string }>> {
    return nomadRequest(this.cfg, "POST", "acl/token/onetime", {});
  }
  async exchangeOneTimeToken(token: string): Promise<ApiResponse<NomadACLToken>> {
    return nomadRequest<NomadACLToken>(this.cfg, "POST", "acl/token/onetime/exchange", { OneTimeSecretID: token });
  }

  // Policies
  async listPolicies(opts: QueryOptions = {}): Promise<ApiResponse<NomadACLPolicy[]>> {
    return nomadRequest<NomadACLPolicy[]>(this.cfg, "GET", "acl/policies", undefined, opts);
  }
  async writePolicy(name: string, policy: NomadACLPolicy): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "POST", `acl/policy/${encodeURIComponent(name)}`, policy);
  }
  async readPolicy(name: string): Promise<ApiResponse<NomadACLPolicy>> {
    return nomadRequest<NomadACLPolicy>(this.cfg, "GET", `acl/policy/${encodeURIComponent(name)}`);
  }
  async selfPolicy(): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", "acl/policy/self");
  }
  async deletePolicy(name: string): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "DELETE", `acl/policy/${encodeURIComponent(name)}`);
  }

  // Roles
  async createRole(req: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", "acl/role", req);
  }
  async updateRole(roleId: string, req: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `acl/role/${encodeURIComponent(roleId)}`, req);
  }
  async listRoles(): Promise<ApiResponse<unknown[]>> {
    return nomadRequest(this.cfg, "GET", "acl/roles");
  }
  async readRole(roleId: string): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", `acl/role/${encodeURIComponent(roleId)}`);
  }
  async readRoleByName(name: string): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", `acl/role/name/${encodeURIComponent(name)}`);
  }
  async deleteRole(roleId: string): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "DELETE", `acl/role/${encodeURIComponent(roleId)}`);
  }

  // Auth Methods
  async createAuthMethod(req: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", "acl/auth-method", req);
  }
  async updateAuthMethod(name: string, req: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `acl/auth-method/${encodeURIComponent(name)}`, req);
  }
  async listAuthMethods(): Promise<ApiResponse<unknown[]>> {
    return nomadRequest(this.cfg, "GET", "acl/auth-methods");
  }
  async readAuthMethod(name: string): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", `acl/auth-method/${encodeURIComponent(name)}`);
  }
  async deleteAuthMethod(name: string): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "DELETE", `acl/auth-method/${encodeURIComponent(name)}`);
  }

  // Binding Rules
  async listBindingRules(): Promise<ApiResponse<unknown[]>> {
    return nomadRequest(this.cfg, "GET", "acl/binding-rules");
  }
  async createBindingRule(req: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", "acl/binding-rule", req);
  }
  async updateBindingRule(ruleId: string, req: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `acl/binding-rule/${encodeURIComponent(ruleId)}`, req);
  }
  async readBindingRule(ruleId: string): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", `acl/binding-rule/${encodeURIComponent(ruleId)}`);
  }
  async deleteBindingRule(ruleId: string): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "DELETE", `acl/binding-rule/${encodeURIComponent(ruleId)}`);
  }

  // OIDC + Login
  async oidcAuthURL(req: Record<string, unknown>): Promise<ApiResponse<{ AuthURL: string }>> {
    return nomadRequest(this.cfg, "POST", "acl/oidc/auth-url", req);
  }
  async oidcCompleteAuth(req: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", "acl/oidc/complete-auth", req);
  }
  async login(req: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", "acl/login", req);
  }
  async identityToken(): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", "acl/identity/client-introduction-token", {});
  }
  async jwks(): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", "../.well-known/jwks.json");
  }
  async oidcConfig(): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", "../.well-known/openid-configuration");
  }
}

export class OperatorClient {
  constructor(private cfg: NomadConfig) {}

  async raftConfig(opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", "operator/raft/configuration", undefined, opts);
  }
  async raftRemovePeer(req: { Address?: string; ID?: string }, opts: QueryOptions = {}): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "DELETE", "operator/raft/peer", undefined, opts, {
      address: req.Address,
      id: req.ID,
    });
  }
  async raftTransferLeadership(id?: string): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "PUT", "operator/raft/transfer-leadership", {}, {}, {
      id,
    });
  }
  async autopilotGetConfig(opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", "operator/autopilot/configuration", undefined, opts);
  }
  async autopilotSetConfig(req: Record<string, unknown>, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "PUT", "operator/autopilot/configuration", req, opts);
  }
  async autopilotHealth(opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", "operator/autopilot/health", undefined, opts);
  }
  async schedulerGetConfig(opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", "operator/scheduler/configuration", undefined, opts);
  }
  async schedulerSetConfig(req: Record<string, unknown>, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "PUT", "operator/scheduler/configuration", req, opts);
  }
  async keyringKeys(opts: QueryOptions = {}): Promise<ApiResponse<unknown[]>> {
    return nomadRequest(this.cfg, "GET", "operator/keyring/keys", undefined, opts);
  }
  async keyringRotate(full = false): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "PUT", "operator/keyring/rotate", {}, {}, { full: full || undefined });
  }
  async keyringDeleteKey(keyId: string): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "DELETE", `operator/keyring/key/${encodeURIComponent(keyId)}`);
  }
  async getLicense(opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", "operator/license", undefined, opts);
  }

  /** Returns raw gzip bytes as Buffer */
  async snapshotSave(outputPath: string): Promise<void> {
    const config = this.cfg;
    const url = `${config.addr}/v1/operator/snapshot`;
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";

    const headers: Record<string, string> = {};
    if (config.token) headers["X-Nomad-Token"] = config.token;

    await new Promise<void>((resolve, reject) => {
      const reqOpts = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname,
        method: "GET",
        headers,
        ...(config.tlsSkipVerify && { rejectUnauthorized: false }),
      };
      const transport = isHttps ? https : http;
      const req = transport.request(reqOpts, (res) => {
        const out = fs.createWriteStream(outputPath);
        res.pipe(out);
        out.on("finish", resolve);
        out.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    });
  }

  async snapshotRestore(inputPath: string): Promise<void> {
    const config = this.cfg;
    const url = `${config.addr}/v1/operator/snapshot`;
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";
    const fileStream = fs.createReadStream(inputPath);
    const stat = fs.statSync(inputPath);

    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(stat.size),
    };
    if (config.token) headers["X-Nomad-Token"] = config.token;

    await new Promise<void>((resolve, reject) => {
      const reqOpts = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname,
        method: "PUT",
        headers,
        ...(config.tlsSkipVerify && { rejectUnauthorized: false }),
      };
      const transport = isHttps ? https : http;
      const req = transport.request(reqOpts, (res) => {
        res.resume();
        res.on("end", () => {
          if ((res.statusCode ?? 0) >= 300) {
            reject(new NomadApiError(`Snapshot restore failed: HTTP ${res.statusCode}`, res.statusCode ?? 0, url));
          } else {
            resolve();
          }
        });
      });
      req.on("error", reject);
      fileStream.pipe(req);
    });
  }

  async upgradeCheckVault(opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", "operator/upgrade-check/vault-workload-identity", undefined, opts);
  }

  async utilization(req: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", "operator/utilization", req);
  }
}

export class AgentClient {
  constructor(private cfg: NomadConfig) {}

  async self(): Promise<ApiResponse<unknown>> { return nomadRequest(this.cfg, "GET", "agent/self"); }
  async members(): Promise<ApiResponse<unknown>> { return nomadRequest(this.cfg, "GET", "agent/members"); }
  async servers(): Promise<ApiResponse<string[]>> { return nomadRequest(this.cfg, "GET", "agent/servers"); }
  async setServers(servers: string[]): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "PUT", "agent/servers", servers);
  }
  async health(): Promise<ApiResponse<unknown>> { return nomadRequest(this.cfg, "GET", "agent/health"); }
  async host(): Promise<ApiResponse<unknown>> { return nomadRequest(this.cfg, "GET", "agent/host"); }
  async join(address: string): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "PUT", "agent/join", {}, {}, { address });
  }
  async forceLeave(node: string): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "PUT", "agent/force-leave", {}, {}, { node });
  }
  async schedulerConfig(): Promise<ApiResponse<unknown>> { return nomadRequest(this.cfg, "GET", "agent/schedulers/config"); }
  async schedulersList(): Promise<ApiResponse<unknown>> { return nomadRequest(this.cfg, "GET", "agent/schedulers"); }
  async setSchedulers(req: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "PUT", "agent/schedulers/config", req);
  }
  async pprof(pprofType: "profile" | "trace" | "goroutine" | "cmdline" | "heap" | "allocs" | "block" | "threadcreate" | "mutex"): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", `agent/pprof/${pprofType}`);
  }
}

export class MiscClient {
  constructor(private cfg: NomadConfig) {}

  async regions(): Promise<ApiResponse<string[]>> { return nomadRequest(this.cfg, "GET", "regions"); }
  async leader(): Promise<ApiResponse<string>> { return nomadRequest(this.cfg, "GET", "status/leader"); }
  async peers(): Promise<ApiResponse<string[]>> { return nomadRequest(this.cfg, "GET", "status/peers"); }
  async gc(): Promise<ApiResponse<void>> { return nomadRequest(this.cfg, "PUT", "system/gc", {}); }
  async reconcileSummaries(): Promise<ApiResponse<void>> { return nomadRequest(this.cfg, "PUT", "system/reconcile/summaries", {}); }
  async metrics(format?: "prometheus"): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", "metrics", undefined, {}, { format });
  }
  async search(req: { Prefix: string; Context: string; Namespace?: string }): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", "search", req);
  }
  async fuzzySearch(req: { Text: string; Context: string; Namespace?: string }): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", "search/fuzzy", req);
  }
  async validateJob(req: NomadJobSubmitRequest): Promise<ApiResponse<{ ValidationErrors?: string[]; Error?: string; Warnings?: string }>> {
    return nomadRequest(this.cfg, "POST", "validate/job", req);
  }
}

export class ScalingClient {
  constructor(private cfg: NomadConfig) {}

  async listPolicies(opts: QueryOptions = {}): Promise<ApiResponse<unknown[]>> {
    return nomadRequest(this.cfg, "GET", "scaling/policies", undefined, opts);
  }
  async readPolicy(policyId: string, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "GET", `scaling/policy/${encodeURIComponent(policyId)}`, undefined, opts);
  }
}

export class QuotasClient {
  constructor(private cfg: NomadConfig) {}

  async list(opts: QueryOptions = {}): Promise<ApiResponse<unknown[]>> { return nomadRequest(this.cfg, "GET", "quotas", undefined, opts); }
  async listUsages(opts: QueryOptions = {}): Promise<ApiResponse<unknown[]>> { return nomadRequest(this.cfg, "GET", "quota-usages", undefined, opts); }
  async read(name: string): Promise<ApiResponse<unknown>> { return nomadRequest(this.cfg, "GET", `quota/${encodeURIComponent(name)}`); }
  async usage(name: string): Promise<ApiResponse<unknown>> { return nomadRequest(this.cfg, "GET", `quota/usage/${encodeURIComponent(name)}`); }
  async write(name: string, quota: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", `quota/${encodeURIComponent(name)}`, quota);
  }
  async delete(name: string): Promise<ApiResponse<void>> { return nomadRequest(this.cfg, "DELETE", `quota/${encodeURIComponent(name)}`); }
}

export class SentinelClient {
  constructor(private cfg: NomadConfig) {}

  async list(opts: QueryOptions = {}): Promise<ApiResponse<unknown[]>> { return nomadRequest(this.cfg, "GET", "sentinel/policies", undefined, opts); }
  async write(name: string, policy: Record<string, unknown>): Promise<ApiResponse<void>> {
    return nomadRequest(this.cfg, "POST", `sentinel/policy/${encodeURIComponent(name)}`, policy);
  }
  async read(name: string): Promise<ApiResponse<unknown>> { return nomadRequest(this.cfg, "GET", `sentinel/policy/${encodeURIComponent(name)}`); }
  async delete(name: string): Promise<ApiResponse<void>> { return nomadRequest(this.cfg, "DELETE", `sentinel/policy/${encodeURIComponent(name)}`); }
}

export class RecommendationsClient {
  constructor(private cfg: NomadConfig) {}

  async list(opts: QueryOptions = {}): Promise<ApiResponse<unknown[]>> { return nomadRequest(this.cfg, "GET", "recommendations", undefined, opts); }
  async read(id: string, opts: QueryOptions = {}): Promise<ApiResponse<unknown>> { return nomadRequest(this.cfg, "GET", `recommendation/${encodeURIComponent(id)}`, undefined, opts); }
  async create(rec: Record<string, unknown>): Promise<ApiResponse<unknown>> { return nomadRequest(this.cfg, "POST", "recommendation", rec); }
  async apply(req: { Recommendations: string[]; PolicyOverride?: boolean }): Promise<ApiResponse<unknown>> {
    return nomadRequest(this.cfg, "POST", "recommendations/apply", req);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Nomad Client Facade
// ─────────────────────────────────────────────────────────────────────────────

export class NomadClient {
  readonly cfg: NomadConfig;
  readonly jobs: JobsClient;
  readonly allocations: AllocationsClient;
  readonly client: ClientClient;
  readonly nodes: NodesClient;
  readonly deployments: DeploymentsClient;
  readonly evaluations: EvaluationsClient;
  readonly volumes: VolumesClient;
  readonly plugins: PluginsClient;
  readonly services: ServicesClient;
  readonly variables: VariablesClient;
  readonly namespaces: NamespacesClient;
  readonly nodePools: NodePoolsClient;
  readonly acl: ACLClient;
  readonly operator: OperatorClient;
  readonly agent: AgentClient;
  readonly scaling: ScalingClient;
  readonly quotas: QuotasClient;
  readonly sentinel: SentinelClient;
  readonly recommendations: RecommendationsClient;
  readonly misc: MiscClient;
  readonly diagnostic: Diagnostic;

  constructor(config?: Partial<NomadConfig>) {
    this.cfg = { ...buildConfig(), ...config };
    this.jobs = new JobsClient(this.cfg);
    this.allocations = new AllocationsClient(this.cfg);
    this.client = new ClientClient(this.cfg);
    this.nodes = new NodesClient(this.cfg);
    this.deployments = new DeploymentsClient(this.cfg);
    this.evaluations = new EvaluationsClient(this.cfg);
    this.volumes = new VolumesClient(this.cfg);
    this.plugins = new PluginsClient(this.cfg);
    this.services = new ServicesClient(this.cfg);
    this.variables = new VariablesClient(this.cfg);
    this.namespaces = new NamespacesClient(this.cfg);
    this.nodePools = new NodePoolsClient(this.cfg);
    this.acl = new ACLClient(this.cfg);
    this.operator = new OperatorClient(this.cfg);
    this.agent = new AgentClient(this.cfg);
    this.scaling = new ScalingClient(this.cfg);
    this.quotas = new QuotasClient(this.cfg);
    this.sentinel = new SentinelClient(this.cfg);
    this.recommendations = new RecommendationsClient(this.cfg);
    this.misc = new MiscClient(this.cfg);
    this.diagnostic = new Diagnostic(this.cfg);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function readFileOrJson(filePathOrJson: string): unknown {
  if (filePathOrJson.startsWith("{") || filePathOrJson.startsWith("[")) {
    return JSON.parse(filePathOrJson);
  }
  const resolved = path.resolve(filePathOrJson);
  const content = fs.readFileSync(resolved, "utf8");
  return JSON.parse(content);
}

function parseKV(pairs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx === -1) throw new Error(`Invalid key=value pair: ${pair}`);
    result[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return result;
}

// Fields whose values must never appear in output.
const REDACTED_KEYS = new Set([
  "SecretID", "secret_id", "SecretId",
  "AccessorID",  // ACL token accessor is not a secret but omit to reduce noise
  "OneTimeSecretID",
  "Token",
]);

const REDACTED_MARKER = "[REDACTED]";

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        REDACTED_KEYS.has(k) ? [k, REDACTED_MARKER] : [k, redactSecrets(v)]
      )
    );
  }
  return value;
}

function projectFields(data: unknown, fields: string[]): unknown {
  if (Array.isArray(data)) return data.map((item) => projectFields(item, fields));
  if (data !== null && typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.includes(".")) {
        // Nested access: Attributes.os.name
        const parts = field.split(".");
        let curr: unknown = data;
        for (const p of parts) {
          if (curr !== null && typeof curr === "object") {
            curr = (curr as Record<string, unknown>)[p];
          } else {
            curr = undefined;
            break;
          }
        }
        result[field] = curr;
      } else if (field in data) {
        result[field] = (data as Record<string, unknown>)[field];
      }
    }
    return result;
  }
  return data;
}

function printTable(data: unknown[], columns: string[]): void {
  if (data.length === 0) {
    console.log("No results.");
    return;
  }

  // Header
  console.log(`| ${columns.join(" | ")} |`);
  console.log(`| ${columns.map(() => "---").join(" | ")} |`);

  // Rows
  for (const item of data) {
    const row = columns.map((col) => {
      const val = (item as Record<string, unknown>)[col];
      if (val === undefined || val === null) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return String(val as string | number | boolean);
    });
    console.log(`| ${row.join(" | ")} |`);
  }
}

const DEFAULT_COLUMNS: Record<string, string[]> = {
  jobs: ["ID", "Type", "Priority", "Status"],
  allocs: ["ID", "JobID", "TaskGroup", "ClientStatus"],
  "alloc-health": ["ID", "JobID", "Status", "LatestEvent", "Restarts", "NodeName"],
  nodes: ["ID", "Name", "Datacenter", "Status", "SchedulingEligibility"],
  "node-usage": ["Name", "CPUPercent", "MemPercent", "AllocatedCPU", "TotalCPU", "AllocatedMem", "TotalMem"],
  "node-stats": ["Name", "CPUTicks", "MemoryUsed", "MemoryTotal", "MemoryPercent"],
  dashboard: ["Name", "Status", "CPUPercent", "MemPercent", "Volumes", "Specialty", "Meta"],
  inventory: ["Name", "NodeClass", "Address", "OS", "Kernel", "Arch", "Nomad", "Consul"],
  topography: ["NodeName", "Status", "Workloads", "Attributes", "Pool"],
  "cluster-summary": ["Category", "Metric", "Value"],
  evals: ["ID", "JobID", "Status", "Type"],
  deployments: ["ID", "JobID", "Status", "StatusDescription"],
  volumes: ["ID", "Name", "Type", "Schedulable"],
};

function printJson(data: unknown): void {
  console.log(JSON.stringify(redactSecrets(data), null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Dispatch
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === "--config" || args[0] === "config") {
    const cfg = buildConfig();
    console.log(JSON.stringify({
      addr: cfg.addr,
      hasToken: !!cfg.token,
      namespace: cfg.namespace ?? "default",
      region: cfg.region ?? "(default)",
      tlsSkipVerify: cfg.tlsSkipVerify ?? false,
    }, null, 2));
    return;
  }

  if (args.length < 2) {
    console.error("Usage: nomad-ops <resource> <action> [args...]");
    console.error("Examples:");
    console.error("  nomad-ops jobs list --short");
    console.error("  nomad-ops job status <job_id>");
    console.error("  nomad-ops volume status <vol_id>");
    console.error("  nomad-ops volume snapshot-create <vol_id> <snap_name>");
    console.error("");
    console.error("Run 'nomad-ops --config' to see current cluster configuration.");
    process.exit(1);
  }

  const [resource, action, ...rest] = args;
  const nomad = new NomadClient();

  // Build query opts and optimization flags
  const qopts: QueryOptions = {};
  const filteredRest: string[] = [];
  let format: "json" | "table" = "json";
  let fields: string[] | undefined;
  let limit: number | undefined;
  let shortMode = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if ((arg === "--namespace" || arg === "--ns") && rest[i + 1]) {
      qopts.namespace = rest[++i];
    } else if (arg === "--region" && rest[i + 1]) {
      qopts.region = rest[++i];
    } else if (arg === "--filter" && rest[i + 1]) {
      qopts.filter = rest[++i];
    } else if (arg === "--prefix" && rest[i + 1]) {
      qopts.prefix = rest[++i];
    } else if (arg === "--per-page" && rest[i + 1]) {
      qopts.perPage = Number(rest[++i]);
    } else if (arg === "--fields" && rest[i + 1]) {
      fields = rest[++i]?.split(",");
    } else if (arg === "--format" && rest[i + 1]) {
      const f = rest[++i];
      if (f === "json" || f === "table") format = f;
    } else if (arg === "--limit" && rest[i + 1]) {
      limit = Number(rest[++i]);
    } else if (arg === "--short" || arg === "-s") {
      shortMode = true;
      format = "table";
    } else {
      filteredRest.push(arg);
    }
  }

  const getArg = (idx: number, usage?: string): string => {
    const val = filteredRest[idx];
    if (!val) throw new Error(`Missing argument at position ${idx}${usage ? `. Usage: ${usage}` : ""}`);
    return val;
  };
  const tryArg = (idx: number): string | undefined => filteredRest[idx];
  const flag = (name: string): string | undefined => {
    const idx = filteredRest.indexOf(`--${name}`);
    if (idx !== -1 && filteredRest[idx + 1]) return filteredRest[idx + 1];
    const prefixed = filteredRest.find((a) => a.startsWith(`--${name}=`));
    if (prefixed) return prefixed.split("=").slice(1).join("=");
    return undefined;
  };
  const hasFlag = (name: string): boolean => filteredRest.includes(`--${name}`);
  const flags = (name: string): string[] => {
    const results: string[] = [];
    for (let i = 0; i < filteredRest.length; i++) {
      const arg = filteredRest[i];
      if (arg === `--${name}` && filteredRest[i + 1]) results.push(filteredRest[++i]);
      else if (arg?.startsWith(`--${name}=`)) results.push(arg.split("=").slice(1).join("="));
    }
    return results;
  };

  try {
    let result: ApiResponse<unknown> | void;

    switch (resource) {
      // ── Jobs ────────────────────────────────────────────────────────────────
      case "job":
      case "jobs":
        switch (action) {
          case "list": result = await nomad.jobs.list({ ...qopts, prefix: qopts.prefix ?? flag("prefix") }); break;
          case "status":
          case "read": {
            const resolved = await new Discovery(buildConfig()).resolveJob(getArg(0, "job read <id>"), qopts);
            result = await nomad.jobs.read(resolved.ID, { ...qopts, namespace: resolved.Namespace });
            if (shortMode && !fields) fields = ["ID", "Name", "Type", "Status", "Namespace", "Priority"];
            break;
          }
          case "submit": {
            const fileOrJson = getArg(0, "job submit <file|--json>");
            let jobData: NomadJob;
            if (fileOrJson.endsWith(".nomad") || fileOrJson.endsWith(".hcl")) {
              const hcl = fs.readFileSync(path.resolve(fileOrJson), "utf8");
              const parsed = await nomad.jobs.parse(hcl, true);
              jobData = parsed.data;
            } else {
              jobData = readFileOrJson(fileOrJson) as NomadJob;
              if ((jobData as { Job?: NomadJob }).Job) jobData = (jobData as { Job: NomadJob }).Job;
            }
            result = await nomad.jobs.register({ Job: jobData }, qopts);
            break;
          }
          case "parse": {
            const hcl = fs.readFileSync(path.resolve(getArg(0, "job parse <file>")), "utf8");
            result = await nomad.jobs.parse(hcl, hasFlag("canonicalize"));
            break;
          }
          case "submission": {
            const resolved = await new Discovery(buildConfig()).resolveJob(getArg(0, "job submission <id>"), qopts);
            result = await nomad.jobs.submission(resolved.ID, flag("version") ? Number(flag("version")) : undefined, { ...qopts, namespace: resolved.Namespace });
            break;
          }
          case "versions": {
            const resolved = await new Discovery(buildConfig()).resolveJob(getArg(0, "job versions <id>"), qopts);
            result = await nomad.jobs.versions(resolved.ID, hasFlag("diffs"), { ...qopts, namespace: resolved.Namespace });
            break;
          }
          case "allocations": {
            const resolved = await new Discovery(buildConfig()).resolveJob(getArg(0, "job allocations <id>"), qopts);
            result = await nomad.jobs.allocations(resolved.ID, { ...qopts, namespace: resolved.Namespace });
            break;
          }
          case "evaluations": {
            const resolved = await new Discovery(buildConfig()).resolveJob(getArg(0, "job evaluations <id>"), qopts);
            result = await nomad.jobs.evaluations(resolved.ID, { ...qopts, namespace: resolved.Namespace });
            break;
          }
          case "deployments": {
            const resolved = await new Discovery(buildConfig()).resolveJob(getArg(0, "job deployments <id>"), qopts);
            result = await nomad.jobs.deployments(resolved.ID, { ...qopts, namespace: resolved.Namespace });
            break;
          }
          case "deployment": {
            const resolved = await new Discovery(buildConfig()).resolveJob(getArg(0, "job deployment <id>"), qopts);
            result = await nomad.jobs.currentDeployment(resolved.ID, { ...qopts, namespace: resolved.Namespace });
            break;
          }
          case "summary": {
            const resolved = await new Discovery(buildConfig()).resolveJob(getArg(0, "job summary <id>"), qopts);
            result = await nomad.jobs.summary(resolved.ID, { ...qopts, namespace: resolved.Namespace });
            break;
          }
          case "update": {
            const jobId = getArg(0, "job update <id> <file>");
            const jobData = readFileOrJson(getArg(1)) as NomadJob;
            result = await nomad.jobs.update(jobId, { Job: jobData }, qopts);
            break;
          }
          case "dispatch": {
            const jobId = getArg(0, "job dispatch <id>");
            const meta = flag("meta") ? parseKV([flag("meta")!]) : undefined;
            const payloadFile = flag("payload");
            const payload = payloadFile ? Buffer.from(fs.readFileSync(path.resolve(payloadFile))).toString("base64") : undefined;
            result = await nomad.jobs.dispatch(jobId, { Meta: meta, Payload: payload }, qopts);
            break;
          }
          case "revert": result = await nomad.jobs.revert(getArg(0, "job revert <id> --version N"), Number(flag("version") ?? "0"), flag("enforce-prior-version") ? Number(flag("enforce-prior-version")) : undefined, qopts); break;
          case "stable": result = await nomad.jobs.markStable(getArg(0, "job stable <id> --version N"), Number(flag("version") ?? "0"), !hasFlag("unstable"), qopts); break;
          case "evaluate": result = await nomad.jobs.evaluate(getArg(0, "job evaluate <id>"), qopts); break;
          case "plan": {
            const jobId = getArg(0, "job plan <id> <file>");
            const jobData = readFileOrJson(getArg(1)) as NomadJob;
            result = await nomad.jobs.plan(jobId, { Job: jobData }, !hasFlag("no-diff"), qopts);
            break;
          }
          case "periodic-force": result = await nomad.jobs.periodicForce(getArg(0, "job periodic-force <id>"), qopts); break;
          case "scale-status": result = await nomad.jobs.getScale(getArg(0, "job scale-status <id>"), qopts); break;
          case "scale": {
            const jobId = getArg(0, "job scale <id> --group G --count N");
            const group = flag("group");
            const count = flag("count");
            const message = flag("message");
            if (!group) throw new Error("--group is required");
            if (!count) throw new Error("--count is required");
            result = await nomad.jobs.scale(jobId, {
              Target: { Group: group },
              Count: Number(count),
              Message: message,
            }, qopts);
            break;
          }
          case "services": result = await nomad.jobs.services(getArg(0, "job services <id>"), qopts); break;
          case "actions": result = await nomad.jobs.actions(getArg(0, "job actions <id>"), qopts); break;
          case "tag": {
            const jobId = getArg(0, "job tag <id> --tag T --version N");
            const tagName = flag("tag");
            const version = flag("version");
            if (!tagName) throw new Error("--tag is required");
            if (!version) throw new Error("--version is required");
            result = await nomad.jobs.tagVersion(jobId, tagName, { Version: Number(version), Description: flag("desc") }, qopts);
            break;
          }
          case "untag": {
            const jobId = getArg(0, "job untag <id> --tag T");
            const tagName = flag("tag");
            if (!tagName) throw new Error("--tag is required");
            result = await nomad.jobs.untagVersion(jobId, tagName, qopts);
            break;
          }
          case "stop": {
            const resolved = await new Discovery(buildConfig()).resolveJob(getArg(0, "job stop <id>"), qopts);
            result = await nomad.jobs.stop(resolved.ID, hasFlag("purge"), hasFlag("global"), { ...qopts, namespace: resolved.Namespace });
            break;
          }
          default: throw new Error(`Unknown job action: ${action}`);
        }
        break;

      // ── Allocations ─────────────────────────────────────────────────────────
      case "alloc":
      case "allocs":
        switch (action) {
          case "list": result = await nomad.allocations.list(qopts); break;
          case "health": {
            result = await nomad.diagnostic.allocHealth(qopts);
            if (shortMode && !fields) fields = DEFAULT_COLUMNS["alloc-health"];
            break;
          }
          case "status":
          case "read": {
            const resolved = await new Discovery(buildConfig()).resolveAlloc(getArg(0, "alloc read <id>"), qopts);
            result = await nomad.allocations.read(resolved.ID, { ...qopts, namespace: resolved.Namespace });
            if (shortMode && !fields) fields = ["ID", "JobID", "NodeName", "ClientStatus", "Namespace"];
            break;
          }
          case "checks": {
            const resolved = await new Discovery(buildConfig()).resolveAlloc(getArg(0, "alloc checks <id>"), qopts);
            result = await nomad.allocations.checks(resolved.ID, { ...qopts, namespace: resolved.Namespace });
            break;
          }
          case "services": {
            const resolved = await new Discovery(buildConfig()).resolveAlloc(getArg(0, "alloc services <id>"), qopts);
            result = await nomad.allocations.services(resolved.ID, { ...qopts, namespace: resolved.Namespace });
            break;
          }
          case "stop": {
            const resolved = await new Discovery(buildConfig()).resolveAlloc(getArg(0, "alloc stop <id>"), qopts);
            result = await nomad.allocations.stop(resolved.ID, hasFlag("no-shutdown-delay"), { ...qopts, namespace: resolved.Namespace });
            break;
          }
          case "logs": {
            const resolved = await new Discovery(buildConfig()).resolveAlloc(getArg(0, "alloc logs <id> <task>"), qopts);
            await nomad.client.streamLogs(resolved.ID, getArg(1), hasFlag("stderr") ? "stderr" : "stdout", { follow: !hasFlag("no-follow"), tail: flag("tail") ? Number(flag("tail")) : undefined });
            return;
          }
          default: throw new Error(`Unknown alloc action: ${action}`);
        }
        break;

      // ── Client ──────────────────────────────────────────────────────────────
      case "client":
        switch (action) {
          case "stats": {
            let nodeId = flag("node-id") ?? tryArg(0);
            if (nodeId) {
              nodeId = await new Discovery(buildConfig()).resolveNode(nodeId, qopts);
            }
            result = await nomad.client.stats(nodeId);
            break;
          }
          case "alloc-stats": result = await nomad.client.allocStats(getArg(0, "client alloc-stats <alloc_id>"), flag("task")); break;
          case "alloc-gc": result = await nomad.client.allocGC(getArg(0, "client alloc-gc <alloc_id>")); break;
          case "alloc-pause": result = await nomad.client.allocPause(getArg(0, "client alloc-pause <alloc_id> [--resume]"), hasFlag("resume") ? "resume" : "pause"); break;
          case "alloc-restart": result = await nomad.client.allocRestart(getArg(0, "client alloc-restart <alloc_id>"), flag("task"), hasFlag("all-tasks")); break;
          case "alloc-signal": result = await nomad.client.allocSignal(getArg(0, "client alloc-signal <alloc_id>"), flag("signal") ?? "SIGTERM", flag("task")); break;
          case "alloc-logs": await nomad.client.streamLogs(getArg(0, "client alloc-logs <id> <task>"), getArg(1), hasFlag("stderr") ? "stderr" : "stdout", { follow: !hasFlag("no-follow"), tail: flag("tail") ? Number(flag("tail")) : undefined }); return;
          case "exec": {
            const resolved = await new Discovery(buildConfig()).resolveAlloc(getArg(0, "client exec <alloc_id> <task> <cmd...>"), qopts);
            const execAllocId = resolved.ID;
            const execTask = flag("task") ?? getArg(1);
            if (!execTask) throw new Error("exec requires <task-name> as 2nd arg or --task <task-name>");
            const execCmd: string[] = filteredRest.slice(hasFlag("task") ? 3 : 2);
            if (!execCmd.length) execCmd.push("/bin/sh");
            const isTTY = hasFlag("tty");
            console.error(`[exec] alloc=${execAllocId} task=${execTask} cmd=${execCmd.join(" ")} tty=${isTTY}`);
            const execResult = await execAlloc(buildConfig(), execAllocId, {
              command: execCmd,
              task: execTask,
              tty: isTTY,
              stdinStream: isTTY ? process.stdin : undefined,
              onStdout: (chunk) => process.stdout.write(chunk),
              onStderr: (chunk) => process.stderr.write(chunk),
            });
            process.exit(execResult.exitCode);
          }
          // eslint-disable-next-line no-fallthrough
          case "fs": {
            const subAction = flag("sub") ?? filteredRest[0];
            const resolved = await new Discovery(buildConfig()).resolveAlloc(getArg(1, "client fs ls/stat/cat/readat <alloc_id> <path>"), qopts);
            const allocId = resolved.ID;
            const filePath = filteredRest[2] ?? "/";
            const fsOpts = { ...qopts, namespace: resolved.Namespace, task: flag("task") };
            switch (subAction) {
              case "ls": result = await nomad.client.fsList(allocId, filePath, fsOpts); break;
              case "stat": result = await nomad.client.fsStat(allocId, filePath, fsOpts); break;
              case "cat": result = await nomad.client.fsCat(allocId, filePath, fsOpts); break;
              case "readat": result = await nomad.client.fsReadAt(allocId, filePath, Number(flag("offset") ?? "0"), Number(flag("limit") ?? "1048576"), fsOpts); break;
              default: throw new Error(`Unknown fs sub-action: ${subAction}`);
            }
            break;
          }
          case "gc": result = await nomad.client.gc(); break;
          case "identity": result = await nomad.client.identity(); break;
          case "identity-renew": result = await nomad.client.identityRenew(); break;
          case "metadata": result = await nomad.client.metadata(); break;
          default: throw new Error(`Unknown client action: ${action}`);
        }
        break;

      // ── Nodes ────────────────────────────────────────────────────────────────
      case "node":
      case "nodes":
        switch (action) {
          case "list": result = await nomad.nodes.list(qopts); break;
          case "usage": {
            result = await nomad.nodes.usage(qopts);
            if (shortMode && !fields) fields = DEFAULT_COLUMNS["node-usage"];
            break;
          }
          case "stats": {
            result = await nomad.nodes.stats(qopts);
            if (shortMode && !fields) fields = DEFAULT_COLUMNS["node-stats"];
            break;
          }
          case "dashboard": {
            result = await nomad.diagnostic.dashboard(qopts);
            if (shortMode && !fields) fields = DEFAULT_COLUMNS["dashboard"];
            break;
          }
          case "inventory": {
            result = await nomad.diagnostic.inventory(qopts);
            if (shortMode && !fields) fields = DEFAULT_COLUMNS["inventory"];
            break;
          }
          case "topography": {
            result = await nomad.diagnostic.topography(qopts);
            if (shortMode && !fields) fields = DEFAULT_COLUMNS["topography"];
            break;
          }
          case "status":
          case "read": {
            const nodeId = await new Discovery(buildConfig()).resolveNode(getArg(0, "node read <id>"), qopts);
            result = await nomad.nodes.read(nodeId, qopts);
            break;
          }
          case "allocations": result = await nomad.nodes.allocations(getArg(0, "node allocations <id>"), qopts); break;
          case "evaluate": result = await nomad.nodes.evaluate(getArg(0, "node evaluate <id>")); break;
          case "drain": {
            const nodeId = getArg(0, "node drain <id>");
            if (hasFlag("disable")) {
              result = await nomad.nodes.drain(nodeId, { DrainSpec: null as unknown as undefined, MarkEligible: true }, qopts);
              console.log(`Node ${nodeId} drain disabled (marked eligible)`);
            } else {
              const deadline = flag("deadline");
              const deadlineNs = deadline ? parseDeadline(deadline) : 3600000000000;
              result = await nomad.nodes.drain(nodeId, { DrainSpec: { Deadline: deadlineNs, IgnoreSystemJobs: hasFlag("ignore-system") } }, qopts);
              console.log(`Node ${nodeId} drain enabled (deadline: ${deadline ?? "1h"})`);
            }
            return;
          }
          case "purge": result = await nomad.nodes.purge(getArg(0, "node purge <id>"), qopts); break;
          case "eligibility": {
            const nodeId = getArg(0, "node eligibility <id> [--disable]");
            const eligible = !hasFlag("disable");
            result = await nomad.nodes.eligibility(nodeId, eligible, qopts);
            console.log(`Node ${nodeId} scheduling eligibility set to: ${eligible ? "eligible" : "ineligible"}`);
            return;
          }
          default: throw new Error(`Unknown node action: ${action}`);
        }
        break;

      // ── Deployments ──────────────────────────────────────────────────────────
      case "deployment":
      case "deployments":
        switch (action) {
          case "list": result = await nomad.deployments.list(qopts); break;
          case "status":
          case "read": result = await nomad.deployments.read(getArg(0, "deployment read <id>"), qopts); break;
          case "allocations": result = await nomad.deployments.allocations(getArg(0, "deployment allocations <id>"), qopts); break;
          case "fail": result = await nomad.deployments.fail(getArg(0, "deployment fail <id>")); break;
          case "pause": result = await nomad.deployments.pause(getArg(0, "deployment pause <id>"), true); break;
          case "resume": result = await nomad.deployments.pause(getArg(0, "deployment resume <id>"), false); break;
          case "promote": result = await nomad.deployments.promote(getArg(0, "deployment promote <id>"), flag("group") ? [flag("group")!] : undefined, hasFlag("all")); break;
          case "alloc-health": {
            const healthy = flag("healthy")?.split(",") ?? [];
            const unhealthy = flag("unhealthy")?.split(",") ?? [];
            result = await nomad.deployments.allocHealth(getArg(0, "deployment alloc-health <id>"), { HealthyAllocationIDs: healthy, UnhealthyAllocationIDs: unhealthy });
            break;
          }
          case "unblock": result = await nomad.deployments.unblock(getArg(0, "deployment unblock <id>")); break;
          default: throw new Error(`Unknown deployment action: ${action}`);
        }
        break;

      // ── Evaluations ──────────────────────────────────────────────────────────
      case "eval":
      case "evals":
        switch (action) {
          case "list": result = await nomad.evaluations.list(qopts); break;
          case "status":
          case "read": result = await nomad.evaluations.read(getArg(0, "eval read <id>"), qopts); break;
          case "allocations": result = await nomad.evaluations.allocations(getArg(0, "eval allocations <id>"), qopts); break;
          case "count": result = await nomad.evaluations.count(qopts); break;
          case "delete": {
            const ids = flag("ids")?.split(",") ?? [];
            result = await nomad.evaluations.delete(ids);
            break;
          }
          default: throw new Error(`Unknown eval action: ${action}`);
        }
        break;

      // ── Volumes ──────────────────────────────────────────────────────────────
      case "volumes":
      case "volume":
        switch (action) {
          case "list": {
            const type = flag("type") as "csi" | "host" | undefined ?? "csi";
            result = await nomad.volumes.list({ ...qopts, type, pluginId: flag("plugin"), nodeId: flag("node") });
            break;
          }
          case "status":
          case "csi-read": {
            const volId = getArg(0, "volume status <id>");
            const resolved = await new Discovery(buildConfig()).resolveCSI(volId, qopts);
            result = await nomad.volumes.csiRead(volId, { ...qopts, namespace: resolved.Namespace });
            break;
          }
          case "csi-register": {
            const req = readFileOrJson(getArg(1, "volume csi-register <id> <json_file>")) as NomadCSIVolume;
            result = await nomad.volumes.csiRegister(getArg(0), req, qopts);
            break;
          }
          case "csi-create": {
            const req = readFileOrJson(getArg(1, "volume csi-create <id> <json_file>")) as NomadCSIVolume;
            result = await nomad.volumes.csiCreate(getArg(0), req, qopts);
            break;
          }
          case "csi-deregister": result = await nomad.volumes.csiDeregister(getArg(0, "volume csi-deregister <id>"), hasFlag("force"), qopts); break;
          case "csi-delete": {
            const secrets = parseKV(flags("secret"));
            result = await nomad.volumes.csiDelete(getArg(0, "volume csi-delete <id>"), Object.keys(secrets).length ? secrets : undefined, qopts);
            break;
          }
          case "csi-detach": {
            const nodeId = flag("node");
            if (!nodeId) throw new Error("--node is required");
            result = await nomad.volumes.csiDetach(getArg(0, "volume csi-detach <id> --node <node_id>"), nodeId, qopts);
            break;
          }
          case "external-list": {
            let pluginId = flag("plugin") ?? tryArg(0);
            if (pluginId && !flag("plugin")) {
              try {
                const resolved = await new Discovery(buildConfig()).resolveCSI(pluginId, qopts);
                pluginId = resolved.PluginID;
                if (!qopts.namespace) qopts.namespace = resolved.Namespace;
              } catch { /* ignore */ }
            }
            if (!pluginId) throw new Error("external-list requires <plugin_id> or <vol_id>");
            result = await nomad.volumes.listExternal(pluginId, qopts);
            break;
          }
          case "snapshot-list": {
            let pluginId = flag("plugin") ?? tryArg(0);
            if (pluginId && !flag("plugin")) {
              try {
                const resolved = await new Discovery(buildConfig()).resolveCSI(pluginId, qopts);
                pluginId = resolved.PluginID;
                if (!qopts.namespace) qopts.namespace = resolved.Namespace;
              } catch { /* ignore */ }
            }
            if (!pluginId) throw new Error("snapshot-list requires <plugin_id> or <vol_id>");
            result = await nomad.volumes.listSnapshots(pluginId, qopts);
            break;
          }
          case "snapshot-create": {
            let req: { PluginID: string; Snapshot?: { VolumeID: string; Name: string; Secrets?: Record<string, string>; Parameters?: Record<string, string> } };
            const first = getArg(0, "volume snapshot-create <plugin_id> <vol_id> <snap_name>");

            if (first.startsWith("{")) {
              req = JSON.parse(first) as typeof req;
            } else {
              let pluginId = first;
              let volId = tryArg(1);
              let snapName = tryArg(2);

              // Smart lookup: if only 2 args, assume vol_id and snap_name, look up plugin_id
              if (volId && !snapName) {
                snapName = volId;
                volId = pluginId;
                console.error(`[smart] looking up plugin for volume ${volId}...`);
                const resolved = await new Discovery(buildConfig()).resolveCSI(volId, qopts);
                pluginId = resolved.PluginID;
                if (!qopts.namespace) qopts.namespace = resolved.Namespace;
                console.error(`[smart] found plugin=${pluginId} ns=${qopts.namespace ?? "default"}`);
              }

              if (!volId || !snapName) {
                throw new Error("snapshot-create requires <plugin_id> <vol_id> <snap_name> OR <vol_id> <snap_name> (with auto-lookup)");
              }

              req = {
                PluginID: pluginId,
                Snapshot: {
                  VolumeID: volId,
                  Name: snapName,
                  Secrets: parseKV(flags("secret")),
                  Parameters: parseKV(flags("param")),
                },
              };
            }
            result = await nomad.volumes.createSnapshot(req, qopts);
            console.log(`HTTP ${result.statusCode} OK: Snapshot creation accepted for '${req.Snapshot?.Name}'`);
            return;
          }
          case "snapshot-delete": {
            let pluginId = flag("plugin") ?? tryArg(0);
            const snapId = flag("snapshot-id") ?? tryArg(1);

            // Smart lookup: if only 2 args and no flags, assume vol_id and snap_id
            if (pluginId && snapId && !flag("plugin") && !flag("snapshot-id") && !tryArg(2)) {
              console.error(`[smart] looking up plugin for volume ${pluginId}...`);
              try {
                const resolved = await new Discovery(buildConfig()).resolveCSI(pluginId, qopts);
                const volId = pluginId;
                pluginId = resolved.PluginID;
                if (!qopts.namespace) qopts.namespace = resolved.Namespace;
                console.error(`[smart] found plugin=${pluginId} ns=${qopts.namespace ?? "default"}. deleting snapshot ${snapId} for volume ${volId}`);
              } catch {
                // Ignore, maybe it was already pluginId and snapId
              }
            }

            if (!pluginId || !snapId) {
              throw new Error("snapshot-delete requires <plugin_id> <snapshot_id> OR <vol_id> <snapshot_id> (with auto-lookup)");
            }

            const secrets = parseKV(flags("secret"));
            result = await nomad.volumes.deleteSnapshot(pluginId, snapId, qopts, Object.keys(secrets).length ? secrets : undefined);
            console.log(`HTTP ${result.statusCode} OK: Snapshot deletion requested for '${snapId}'`);
            return;
          }
          case "claim-delete": result = await nomad.volumes.deleteClaim(getArg(0, "volume claim-delete <id>"), qopts); break;
          case "host-read": result = await nomad.volumes.hostRead(getArg(0, "volume host-read <id>"), qopts); break;
          case "host-register": { const req = readFileOrJson(getArg(1, "volume host-register <id> <json_file>")) as NomadHostVolume; result = await nomad.volumes.hostRegister(getArg(0), req, qopts); break; }
          case "host-create": { const req = readFileOrJson(getArg(1, "volume host-create <id> <json_file>")) as NomadHostVolume; result = await nomad.volumes.hostCreate(getArg(0), req, qopts); break; }
          case "host-delete": result = await nomad.volumes.hostDelete(getArg(0, "volume host-delete <id>"), qopts); break;
          default: throw new Error(`Unknown volume action: ${action}`);
        }
        break;

      case "diagnostic":
        switch (action) {
          case "summary": {
            const sum = await nomad.diagnostic.summary(qopts);
            // Flatten summary for table output
            const flat = [];
            for (const [cat, metrics] of Object.entries(sum.data)) {
              for (const [m, v] of Object.entries(metrics as Record<string, number>)) {
                flat.push({ Category: cat, Metric: m, Value: v });
              }
            }
            result = { data: flat, statusCode: 200 };
            if (shortMode && !fields) fields = DEFAULT_COLUMNS["cluster-summary"];
            break;
          }
          case "health": {
            result = await nomad.diagnostic.allocHealth(qopts);
            if (shortMode && !fields) fields = DEFAULT_COLUMNS["alloc-health"];
            break;
          }
          case "topography": {
            result = await nomad.diagnostic.topography(qopts);
            if (shortMode && !fields) fields = DEFAULT_COLUMNS["topography"];
            break;
          }
          case "dashboard": {
            result = await nomad.diagnostic.dashboard(qopts);
            if (shortMode && !fields) fields = DEFAULT_COLUMNS["dashboard"];
            break;
          }
          case "inventory": {
            result = await nomad.diagnostic.inventory(qopts);
            if (shortMode && !fields) fields = DEFAULT_COLUMNS["inventory"];
            break;
          }
          default: throw new Error(`Unknown diagnostic action: ${action}`);
        }
        break;

      // ── Plugins ──────────────────────────────────────────────────────────────
      case "plugin":
      case "plugins":
        if (action === "list") result = await nomad.plugins.list(qopts);
        else if (action === "status" || action === "csi-read") result = await nomad.plugins.readCSI(getArg(0, "plugin status <id>"), qopts);
        else throw new Error(`Unknown plugin action: ${action}`);
        break;

      // ── Services ─────────────────────────────────────────────────────────────
      case "service":
      case "services":
        if (action === "list") result = await nomad.services.list(qopts);
        else if (action === "status" || action === "read") result = await nomad.services.read(getArg(0, "service read <name>"), qopts);
        else if (action === "delete") result = await nomad.services.delete(getArg(0, "service delete <job_id> <service_name>"), getArg(1), qopts);
        else throw new Error(`Unknown service action: ${action}`);
        break;

      // ── Variables ────────────────────────────────────────────────────────────
      case "var":
      case "vars":
        if (action === "list") result = await nomad.variables.list(tryArg(0), qopts);
        else if (action === "status" || action === "read") {
          const path = getArg(0, "var read <path>");
          try {
            result = await nomad.variables.read(path, qopts);
          } catch (err) {
            // Smart fallback: if not found, search for it across namespaces
            const list = await nomad.variables.list(undefined, { ...qopts, namespace: "*" });
            const match = list.data.find((v) => v.Path === path);
            if (match) {
              result = await nomad.variables.read(path, { ...qopts, namespace: match.Namespace });
            } else {
              throw err;
            }
          }
        }
        else if (action === "write") {
          const varPath = getArg(0, "var write <path> <file|--kv>");
          let variable: NomadVariable;
          if (filteredRest[1] && !filteredRest[1].startsWith("--")) {
            variable = { Path: varPath, Items: readFileOrJson(filteredRest[1]) as Record<string, string> };
          } else {
            const kvs = filteredRest.filter((_, i) => filteredRest[i - 1] === "--kv");
            variable = { Path: varPath, Items: parseKV(kvs) };
          }
          result = await nomad.variables.write(varPath, variable, flag("cas") ? Number(flag("cas")) : undefined, qopts);
        }
        else if (action === "delete") result = await nomad.variables.delete(getArg(0, "var delete <path>"), flag("cas") ? Number(flag("cas")) : undefined, qopts);
        else if (action === "lock-acquire") result = await nomad.variables.lockAcquire(getArg(0, "var lock-acquire <path> <json_file>"), readFileOrJson(getArg(1)) as NomadVariable, qopts);
        else if (action === "lock-renew") result = await nomad.variables.lockRenew(getArg(0, "var lock-renew <path> --lock-id <id>"), { Path: getArg(0), Lock: { ID: flag("lock-id") } }, qopts);
        else if (action === "lock-release") result = await nomad.variables.lockRelease(getArg(0, "var lock-release <path> --lock-id <id>"), { Path: getArg(0), Lock: { ID: flag("lock-id") } }, qopts);
        else throw new Error(`Unknown var action: ${action}`);
        break;

      // ── Namespaces ───────────────────────────────────────────────────────────
      case "namespace":
      case "namespaces":
        if (action === "list") result = await nomad.namespaces.list(qopts);
        else if (action === "status" || action === "read") result = await nomad.namespaces.read(getArg(0, "namespace read <name>"), qopts);
        else if (action === "write") {
          const name = getArg(0, "namespace write <name>");
          const ns: NomadNamespace = filteredRest[1] && !filteredRest[1].startsWith("--")
            ? readFileOrJson(filteredRest[1]) as NomadNamespace
            : { Name: name, Description: flag("desc") ?? flag("description") };
          result = await nomad.namespaces.write(name, ns);
        }
        else if (action === "delete") result = await nomad.namespaces.delete(getArg(0, "namespace delete <name>"));
        else throw new Error(`Unknown namespace action: ${action}`);
        break;

      // ── Node Pools ───────────────────────────────────────────────────────────
      case "node-pool":
      case "node-pools":
        if (action === "list") result = await nomad.nodePools.list(qopts);
        else if (action === "status" || action === "read") result = await nomad.nodePools.read(getArg(0, "node-pool read <name>"), qopts);
        else if (action === "write") result = await nomad.nodePools.write(getArg(0, "node-pool write <name> <json_file>"), readFileOrJson(getArg(1)) as NomadNodePool);
        else if (action === "delete") result = await nomad.nodePools.delete(getArg(0, "node-pool delete <name>"));
        else if (action === "nodes") result = await nomad.nodePools.nodes(getArg(0, "node-pool nodes <name>"), qopts);
        else if (action === "jobs") result = await nomad.nodePools.jobs(getArg(0, "node-pool jobs <name>"), qopts);
        else throw new Error(`Unknown node-pool action: ${action}`);
        break;

      // ── ACL ──────────────────────────────────────────────────────────────────
      case "acl":
        switch (action) {
          case "bootstrap": result = await nomad.acl.bootstrap(filteredRest[0]); break;
          case "tokens": result = await nomad.acl.listTokens(qopts); break;
          case "token-create": { const req = readFileOrJson(getArg(0)) as NomadACLToken; result = await nomad.acl.createToken(req); break; }
          case "token-update": { const req = readFileOrJson(getArg(1)) as NomadACLToken; result = await nomad.acl.updateToken(getArg(0), req); break; }
          case "token-read": result = await nomad.acl.readToken(getArg(0)); break;
          case "token-self": result = await nomad.acl.selfToken(); break;
          case "token-delete": result = await nomad.acl.deleteToken(getArg(0)); break;
          case "token-onetime": result = await nomad.acl.oneTimeToken(); break;
          case "token-ott-exchange": result = await nomad.acl.exchangeOneTimeToken(getArg(0)); break;
          case "policies": result = await nomad.acl.listPolicies(qopts); break;
          case "policy-write": { const policy = readFileOrJson(getArg(1)) as NomadACLPolicy; result = await nomad.acl.writePolicy(getArg(0), policy); break; }
          case "policy-read": result = await nomad.acl.readPolicy(getArg(0)); break;
          case "policy-self": result = await nomad.acl.selfPolicy(); break;
          case "policy-delete": result = await nomad.acl.deletePolicy(getArg(0)); break;
          case "roles": result = await nomad.acl.listRoles(); break;
          case "role-create": { const req = readFileOrJson(getArg(0)) as Record<string, unknown>; result = await nomad.acl.createRole(req); break; }
          case "role-update": { const req = readFileOrJson(getArg(1)) as Record<string, unknown>; result = await nomad.acl.updateRole(getArg(0), req); break; }
          case "role-read": result = await nomad.acl.readRole(getArg(0)); break;
          case "role-read-name": result = await nomad.acl.readRoleByName(getArg(0)); break;
          case "role-delete": result = await nomad.acl.deleteRole(getArg(0)); break;
          case "auth-methods": result = await nomad.acl.listAuthMethods(); break;
          case "auth-method-create": { const req = readFileOrJson(getArg(0)) as Record<string, unknown>; result = await nomad.acl.createAuthMethod(req); break; }
          case "auth-method-update": { const req = readFileOrJson(getArg(1)) as Record<string, unknown>; result = await nomad.acl.updateAuthMethod(getArg(0), req); break; }
          case "auth-method-read": result = await nomad.acl.readAuthMethod(getArg(0)); break;
          case "auth-method-delete": result = await nomad.acl.deleteAuthMethod(getArg(0)); break;
          case "binding-rules": result = await nomad.acl.listBindingRules(); break;
          case "binding-rule-create": { const req = readFileOrJson(getArg(0)) as Record<string, unknown>; result = await nomad.acl.createBindingRule(req); break; }
          case "binding-rule-update": { const req = readFileOrJson(getArg(1)) as Record<string, unknown>; result = await nomad.acl.updateBindingRule(getArg(0), req); break; }
          case "binding-rule-read": result = await nomad.acl.readBindingRule(getArg(0)); break;
          case "binding-rule-delete": result = await nomad.acl.deleteBindingRule(getArg(0)); break;
          case "oidc-auth-url": { const req = readFileOrJson(getArg(0)) as Record<string, unknown>; result = await nomad.acl.oidcAuthURL(req); break; }
          case "oidc-complete-auth": { const req = readFileOrJson(getArg(0)) as Record<string, unknown>; result = await nomad.acl.oidcCompleteAuth(req); break; }
          case "login": { const req = readFileOrJson(getArg(0)) as Record<string, unknown>; result = await nomad.acl.login(req); break; }
          case "identity-token": result = await nomad.acl.identityToken(); break;
          case "jwks": result = await nomad.acl.jwks(); break;
          case "oidc-config": result = await nomad.acl.oidcConfig(); break;
          default: throw new Error(`Unknown acl action: ${action}`);
        }
        break;

      // ── Operator ─────────────────────────────────────────────────────────────
      case "operator":
        switch (action) {
          case "raft-config": result = await nomad.operator.raftConfig(qopts); break;
          case "raft-remove-peer": result = await nomad.operator.raftRemovePeer({ Address: flag("address"), ID: flag("id") }, qopts); break;
          case "raft-transfer-leadership": result = await nomad.operator.raftTransferLeadership(flag("id")); break;
          case "autopilot-config": result = await nomad.operator.autopilotGetConfig(qopts); break;
          case "autopilot-set": { const req = readFileOrJson(getArg(0)) as Record<string, unknown>; result = await nomad.operator.autopilotSetConfig(req, qopts); break; }
          case "autopilot-health": result = await nomad.operator.autopilotHealth(qopts); break;
          case "scheduler-config": result = await nomad.operator.schedulerGetConfig(qopts); break;
          case "scheduler-set": { const req = readFileOrJson(getArg(0)) as Record<string, unknown>; result = await nomad.operator.schedulerSetConfig(req, qopts); break; }
          case "keyring-keys": result = await nomad.operator.keyringKeys(qopts); break;
          case "keyring-rotate": await nomad.operator.keyringRotate(hasFlag("full")); console.log("keyring rotated"); return;
          case "keyring-delete": result = await nomad.operator.keyringDeleteKey(getArg(0)); break;
          case "license": result = await nomad.operator.getLicense(qopts); break;
          case "snapshot-save": { await nomad.operator.snapshotSave(getArg(0)); console.log(`Snapshot saved to ${getArg(0)}`); return; }
          case "snapshot-restore": { await nomad.operator.snapshotRestore(getArg(0)); console.log("Snapshot restored"); return; }
          case "upgrade-check-vault": result = await nomad.operator.upgradeCheckVault(qopts); break;
          case "utilization": { const req = readFileOrJson(getArg(0)) as Record<string, unknown>; result = await nomad.operator.utilization(req); break; }
          default: throw new Error(`Unknown operator action: ${action}`);
        }
        break;

      // ── Agent ────────────────────────────────────────────────────────────────
      case "agent":
        switch (action) {
          case "self": result = await nomad.agent.self(); break;
          case "members": result = await nomad.agent.members(); break;
          case "servers": result = await nomad.agent.servers(); break;
          case "health": result = await nomad.agent.health(); break;
          case "host": result = await nomad.agent.host(); break;
          case "join": result = await nomad.agent.join(getArg(0)); break;
          case "force-leave": result = await nomad.agent.forceLeave(getArg(0)); break;
          case "scheduler-config": result = await nomad.agent.schedulerConfig(); break;
          case "scheduler-set": { const req = readFileOrJson(getArg(0)) as Record<string, unknown>; result = await nomad.agent.setSchedulers(req); break; }
          case "pprof": result = await nomad.agent.pprof(flag("type") as "profile" ?? "profile"); break;
          case "monitor": {
            // GET /v1/agent/monitor — streams log lines as NDJSON chunks
            const logLevel = flag("log-level") ?? "info";
            const nodeId = flag("node-id");
            const serverId = flag("server-id");
            const monitorQs = [`log_level=${encodeURIComponent(logLevel)}`];
            if (nodeId) monitorQs.push(`node_id=${encodeURIComponent(nodeId)}`);
            if (serverId) monitorQs.push(`server_id=${encodeURIComponent(serverId)}`);
            const monitorUrl = `${buildConfig().addr}/v1/agent/monitor?${monitorQs.join("&")}`;
            const ac = new AbortController();
            process.on("SIGINT", () => ac.abort());
            process.on("SIGTERM", () => ac.abort());
            await new Promise<void>((resolve, reject) => {
              const parsed = new URL(monitorUrl);
              const reqModule = parsed.protocol === "https:" ? https : http;
              const req = reqModule.request(
                { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: "GET",
                  headers: buildConfig().token ? { "X-Nomad-Token": buildConfig().token } : {} },
                (res) => {
                  const rl = readline.createInterface({ input: res, crlfDelay: Infinity });
                  rl.on("line", (line) => {
                    if (line.trim()) process.stdout.write(line + "\n");
                  });
                  rl.on("close", resolve);
                  rl.on("error", reject);
                }
              );
              req.on("error", reject);
              ac.signal.addEventListener("abort", () => { req.destroy(); resolve(); });
              req.end();
            });
            return;
          }
          default: throw new Error(`Unknown agent action: ${action}`);
        }
        break;

      // ── Scaling ──────────────────────────────────────────────────────────────
      case "scaling":
        switch (action) {
          case "list": result = await nomad.scaling.listPolicies(qopts); break;
          case "read": result = await nomad.scaling.readPolicy(getArg(0), qopts); break;
          default: throw new Error(`Unknown scaling action: ${action}`);
        }
        break;

      // ── Quotas ───────────────────────────────────────────────────────────────
      case "quotas":
        switch (action) {
          case "list": result = await nomad.quotas.list(qopts); break;
          case "usages": result = await nomad.quotas.listUsages(qopts); break;
          default: throw new Error(`Unknown quotas action: ${action}`);
        }
        break;

      case "quota":
        switch (action) {
          case "read": result = await nomad.quotas.read(getArg(0)); break;
          case "usage": result = await nomad.quotas.usage(getArg(0)); break;
          case "write": { const q = readFileOrJson(getArg(1)) as Record<string, unknown>; result = await nomad.quotas.write(getArg(0), q); break; }
          case "delete": result = await nomad.quotas.delete(getArg(0)); break;
          default: throw new Error(`Unknown quota action: ${action}`);
        }
        break;

      // ── Sentinel ─────────────────────────────────────────────────────────────
      case "sentinel":
        switch (action) {
          case "list": result = await nomad.sentinel.list(qopts); break;
          case "write": { const policy = readFileOrJson(getArg(1)) as Record<string, unknown>; result = await nomad.sentinel.write(getArg(0), policy); break; }
          case "read": result = await nomad.sentinel.read(getArg(0)); break;
          case "delete": result = await nomad.sentinel.delete(getArg(0)); break;
          default: throw new Error(`Unknown sentinel action: ${action}`);
        }
        break;

      // ── Recommendations ──────────────────────────────────────────────────────
      case "recommendations":
        switch (action) {
          case "list": result = await nomad.recommendations.list(qopts); break;
          case "apply": { const req = readFileOrJson(getArg(0)) as { Recommendations: string[]; PolicyOverride?: boolean }; result = await nomad.recommendations.apply(req); break; }
          default: throw new Error(`Unknown recommendations action: ${action}`);
        }
        break;

      case "recommendation":
        switch (action) {
          case "read": result = await nomad.recommendations.read(getArg(0), qopts); break;
          case "create": { const rec = readFileOrJson(getArg(0)) as Record<string, unknown>; result = await nomad.recommendations.create(rec); break; }
          default: throw new Error(`Unknown recommendation action: ${action}`);
        }
        break;

      // ── Async Concurrency Helpers ─────────────────────────────────────────────
      case "batch-status": {
        // Usage: batch-status alloc <id1> <id2> ...
        // Usage: batch-status job <job-id>   (resolves allocs then batch-fetches)
        const batchTarget = action; // "alloc" | "job"
        const cfg = buildConfig();
        if (batchTarget === "alloc") {
          const ids = filteredRest.slice(1);
          if (!ids.length) throw new Error("batch-status alloc requires at least one alloc ID");
          const statuses = await batchAllocStatus(cfg, ids, Number(flag("concurrency") ?? "8"));
          printJson(statuses);
        } else if (batchTarget === "job") {
          const jobId = getArg(1);
          const allocResp = await nomad.jobs.allocations(jobId, qopts);
          const ids = allocResp.data.map((a) => a.ID);
          const statuses = await batchAllocStatus(cfg, ids, Number(flag("concurrency") ?? "8"));
          printJson(statuses);
        } else {
          throw new Error("batch-status requires target: alloc | job");
        }
        return;
      }

      case "watch": {
        // Usage: watch deployment <deployment-id>
        // Usage: watch job-allocs <job-id> --count <n>
        const watchTarget = action; // "deployment" | "job-allocs"
        const cfg = buildConfig();
        if (watchTarget === "deployment") {
          const deployId = getArg(1);
          const final = await watchDeployment(cfg, deployId, (d) => {
            process.stderr.write(`[watch] deployment=${deployId} status=${d.Status}\n`);
          }, Number(flag("timeout") ?? "600000"));
          printJson(final);
        } else if (watchTarget === "job-allocs") {
          const jobId = getArg(1);
          const count = Number(flag("count") ?? "1");
          const allocs = await waitForJobAllocs(cfg, jobId, count, Number(flag("timeout") ?? "300000"));
          printJson(allocs);
        } else {
          throw new Error("watch requires target: deployment | job-allocs");
        }
        return;
      }

      // ── Misc ─────────────────────────────────────────────────────────────────
      // ── Concurrency Helpers ───────────────────────────────────────────────────
      case "batch-alloc-status": {
        // Usage: batch-alloc-status <alloc-id> [<alloc-id> ...] [--concurrency=N]
        const ids = filteredRest.filter((a) => !a.startsWith("--"));
        if (!ids.length) throw new Error("batch-alloc-status requires one or more alloc IDs");
        const concurrency = flag("concurrency") ? Number(flag("concurrency")) : 8;
        const batchResult = await batchAllocStatus(buildConfig(), ids, concurrency);
        printJson(batchResult);
        return;
      }

      case "watch-deployment": {
        // Usage: watch-deployment <deployment-id> [--timeout=600000]
        const depId = getArg(0);
        const timeoutMs = flag("timeout") ? Number(flag("timeout")) : 600_000;
        console.error(`[watch] deployment=${depId} timeout=${timeoutMs}ms`);
        const finalDep = await watchDeployment(buildConfig(), depId, (d) => {
          process.stderr.write(`[watch] status=${d.Status} ${JSON.stringify(
            Object.fromEntries(Object.entries(d.TaskGroups ?? {}).map(([k, v]) => [k, `${v.HealthyAllocs}/${v.DesiredTotal}`]))
          )}\n`);
        }, timeoutMs);
        printJson(finalDep);
        return;
      }

      case "wait-job-allocs": {
        // Usage: wait-job-allocs <job-id> <desired-count> [--timeout=300000]
        const wjId = getArg(0);
        const wjCount = Number(getArg(1));
        const wjTimeout = flag("timeout") ? Number(flag("timeout")) : 300_000;
        console.error(`[wait] job=${wjId} desired=${wjCount}`);
        const allocs = await waitForJobAllocs(buildConfig(), wjId, wjCount, wjTimeout);
        printJson(allocs);
        return;
      }

      case "regions": result = await nomad.misc.regions(); break;
      case "status":
        if (action === "leader") result = await nomad.misc.leader();
        else if (action === "peers") result = await nomad.misc.peers();
        else throw new Error(`Unknown status action: ${action}`);
        break;
      case "system":
        if (action === "gc") result = await nomad.misc.gc();
        else if (action === "reconcile-summaries") result = await nomad.misc.reconcileSummaries();
        else throw new Error(`Unknown system action: ${action}`);
        break;
      case "metrics": result = await nomad.misc.metrics(flag("format") as "prometheus" | undefined); break;
      case "search":
        if (action === "fuzzy") {
          result = await nomad.misc.fuzzySearch({ Text: getArg(0), Context: flag("context") ?? "all", Namespace: qopts.namespace });
        } else {
          result = await nomad.misc.search({ Prefix: getArg(0), Context: flag("context") ?? "all", Namespace: qopts.namespace });
        }
        break;
      case "validate": {
        const fileOrJson = getArg(0);
        let jobData: NomadJob;
        if (fileOrJson.endsWith(".nomad") || fileOrJson.endsWith(".hcl")) {
          const hcl = fs.readFileSync(path.resolve(fileOrJson), "utf8");
          const parsed = await nomad.jobs.parse(hcl, true);
          jobData = parsed.data;
        } else {
          jobData = readFileOrJson(fileOrJson) as NomadJob;
          if ((jobData as { Job?: NomadJob }).Job) jobData = (jobData as { Job: NomadJob }).Job;
        }
        result = await nomad.misc.validateJob({ Job: jobData });
        break;
      }
      case "event":
      case "events":
        if (action === "stream") {
          const ac = new AbortController();
          process.on("SIGINT", () => ac.abort());
          process.on("SIGTERM", () => ac.abort());
          await eventStream(buildConfig(), {
            index: flag("index") ? Number(flag("index")) : 0,
            namespace: flag("namespace") ?? qopts.namespace,
            topics: filteredRest.filter((a) => !a.startsWith("--")),
            onEvents: (events) => {
              for (const ev of events) {
                printJson(ev);
              }
            },
            signal: ac.signal,
          });
          return;
        }
        throw new Error(`Unknown events action: ${action}`);
      default:
        throw new Error(`Unknown resource: ${resource}`);
    }

    if (result !== undefined) {
      const data = result.data;

      if (data === null || data === undefined) {
        console.log(`HTTP ${result.statusCode} OK (empty response)`);
        return;
      }

      let processedData: unknown = data;

      // Apply short mode defaults if requested and no specific fields provided
      if (shortMode && !fields) {
        fields = DEFAULT_COLUMNS[resource] ?? DEFAULT_COLUMNS[resource.replace(/s$/, "")] ?? DEFAULT_COLUMNS[resource + "s"];
      }

      // Apply projection
      if (fields) {
        processedData = projectFields(processedData, fields);
      }

      // Apply safety limit for arrays
      if (Array.isArray(processedData)) {
        const finalLimit = limit ?? (shortMode ? 20 : 50);
        if (processedData.length > finalLimit) {
          processedData = processedData.slice(0, finalLimit);
        }
      }

      // Output based on format
      if (format === "table" && Array.isArray(processedData)) {
        const cols = fields ?? (processedData.length > 0 ? Object.keys(processedData[0] as Record<string, unknown>) : []);
        printTable(processedData, cols);
      } else {
        printJson(processedData);
      }
    }
  } catch (err) {
    if (err instanceof NomadApiError) {
      if (err.statusCode === 403 || err.statusCode === 401) {
        const hasToken = !!process.env["NOMAD_TOKEN"];
        if (!hasToken) {
          console.error(`Auth error [${err.statusCode}]: NOMAD_TOKEN is not set. Export a valid token and retry.`);
        } else {
          console.error(`Auth error [${err.statusCode}]: token rejected. Token may be expired, revoked, or lack the required ACL policy for this endpoint.`);
          console.error(`  endpoint : ${err.endpoint}`);
        }
      } else {
        console.error(`API Error [${err.statusCode}] ${err.endpoint}`);
        console.error(err.body ?? err.message);
      }
    } else {
      console.error(err instanceof Error ? err.message : String(err));
    }
    process.exit(1);
  }
}

function parseDeadline(deadline: string): number {
  const unit = deadline.slice(-1);
  const value = Number(deadline.slice(0, -1));
  switch (unit) {
    case "s": return value * 1_000_000_000;
    case "m": return value * 60 * 1_000_000_000;
    case "h": return value * 3600 * 1_000_000_000;
    default: return Number(deadline) * 1_000_000_000;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
