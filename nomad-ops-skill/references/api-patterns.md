# Nomad API Patterns Reference

## Authentication

Every request that requires authorization must carry one of:

```
X-Nomad-Token: <secret-id>
Authorization: Bearer <secret-id>
```

TLS mutual auth (`NOMAD_CACERT`, `NOMAD_CLIENT_CERT`, `NOMAD_CLIENT_KEY`) is
layered on top of token auth when the cluster enforces mTLS.

---

## Blocking Queries

Endpoints that support blocking queries return `X-Nomad-Index` in the response
header. On subsequent calls, pass that value as the `index` query parameter to
long-poll for changes:

```
GET /v1/jobs?index=42&wait=5m
```

- `wait` max is `10m`; default is `5m`. A random jitter of up to `wait/16` is
  added server-side.
- A blocking response is **not** a guarantee of change — the timeout may have
  elapsed or an idempotent write occurred.
- The `watchDeployment` and `waitForJobAllocs` helpers in `nomad-client.ts`
  implement this pattern automatically.

### In the client

```ts
// Manual blocking query
const resp = await nomad.jobs.list({ index: lastIndex, wait: "5m" });
lastIndex = resp.meta?.index ?? lastIndex;
```

---

## Pagination

Paginated list endpoints accept:

| Parameter    | Type   | Description                                 |
|--------------|--------|---------------------------------------------|
| `per_page`   | int    | Max results per page (0 = unpaginated)      |
| `next_token` | string | Cursor from `X-Nomad-NextToken` response header |
| `reverse`    | bool   | Reverse sort order                          |

When the last page is reached, `X-Nomad-NextToken` is absent.

```ts
let nextToken: string | undefined;
do {
  const resp = await nomad.jobs.list({ perPage: 100, nextToken });
  process(resp.data);
  nextToken = resp.meta?.nextToken;
} while (nextToken);
```

---

## Filtering

Filtering is executed server-side. Pass `filter=<expression>` (URL-encoded).
Cannot be combined with index-backed query parameters (e.g. `prefix`).

### Operators

```
==  !=  is empty  is not empty
in  not in  contains  not contains
matches  not matches   (regex)
is nil  is not nil
and  or  not  ( )
```

### Examples

```
Status != "complete"
TaskGroups["api"].Count > 1
"dc1" in Datacenters
JobID matches "^web-.+"
ClientStatus == "running" and DesiredStatus == "run"
```

### List stubs vs full objects

Filter expressions operate on the **full** resource, not the stub returned in
list responses. Use full-object field names (e.g. `HTTPAddr` not `Address`
when filtering nodes).

---

## Consistency Modes

| Mode      | Query Param | Behaviour                                          |
|-----------|-------------|----------------------------------------------------|
| `default` | _(none)_    | Strongly consistent; tiny stale window at leader election |
| `stale`   | `stale=true`| Any server responds; results within ~50 ms of leader |

`X-Nomad-LastContact` (ms since leader contact) and `X-Nomad-KnownLeader`
(bool) headers help clients gauge result freshness.

---

## Namespaces

Append `namespace=<ns>` to any request. Use `namespace=*` to query all
namespaces (requires a token authorized for each, or a wildcard ACL policy).

```ts
const resp = await nomad.jobs.list({ namespace: "*" });
```

---

## Cross-Region Requests

Append `region=<name>`. The request is forwarded transparently to a server in
that region.

```ts
const resp = await nomad.jobs.list({}, { region: "us-west-2" });
// or via env:  NOMAD_REGION=us-west-2
```

---

## Compressed Responses

```
Accept-Encoding: gzip
```

The Node.js `http`/`https` modules do **not** auto-decompress. The client in
`nomad-client.ts` omits this header by default; add `Accept-Encoding: gzip`
and wrap the response stream in `zlib.createGunzip()` only when dealing with
large list payloads that justify the overhead.

---

## HTTP Methods & Response Codes

| Code | Meaning                                     |
|------|---------------------------------------------|
| 200  | Success with body                           |
| 204  | Success, no body (DELETE, some PUTs)        |
| 400  | Validation failure; retry with corrected params |
| 403  | Unauthenticated / unauthorized              |
| 404  | Resource not found                          |
| 5xx  | Server error; do not retry immediately      |

---

## Streaming Protocols

### Log streaming — chunked HTTP

`GET /v1/client/fs/logs/:alloc_id`

Response is a persistent chunked-transfer JSON stream. Each chunk is a JSON
object:

```json
{ "Data": "<base64>", "File": "alloc/logs/redis.stdout.0", "FileEvent": "start" }
```

Decode `Data` with `Buffer.from(msg.Data, "base64").toString("utf8")`.

The `streamLogs` method in `ClientClient` implements this using
`readline.createInterface` to split on newlines.

### Alloc exec — WebSocket upgrade

`GET /v1/client/allocation/:alloc_id/exec`

HTTP/1.1 connection upgraded to WebSocket (RFC 6455). Frame format: text
frames carrying JSON. See full protocol in `execAlloc` in `nomad-client.ts`.

**Request frames (client → server)**
```json
{ "stdin": { "data": "<base64>" } }
{ "stdin": { "close": true } }
{ "tty_size": { "height": 24, "width": 80 } }
```

**Response frames (server → client)**
```json
{ "stdout": { "data": "<base64>" } }
{ "stderr": { "data": "<base64>" } }
{ "exited": true }
{ "result": { "exit_code": 0 } }
```

### Event stream — NDJSON long-poll

`GET /v1/event/stream`

Persistent HTTP response body in NDJSON format (`\n`-delimited JSON objects).
Each line is either a heartbeat `{}` or a batch:

```json
{ "Index": 42, "Events": [ { "Topic": "Job", "Type": "JobRegistered", "Key": "redis", ... } ] }
```

The `eventStream` function in `nomad-client.ts` handles reconnection with
exponential backoff and processes lines via `readline.createInterface`.

**Topic × ACL requirements (common)**

| Topic        | Required ACL                 |
|--------------|------------------------------|
| `*`          | `management`                 |
| `Job`        | `namespace:read-job`         |
| `Allocation` | `namespace:read-job`         |
| `Deployment` | `namespace:read-job`         |
| `Node`       | `node:read`                  |
| `CSIVolume`  | `namespace:csi-read-volume`  |
| `HostVolume` | `namespace:host-volume-read` |
| `Operator`   | `operator:read`              |

### Agent monitor — NDJSON log stream

`GET /v1/agent/monitor?log_level=<level>[&node_id=<id>][&server_id=<id>]`

Same NDJSON chunked format as event stream. Implemented in the `monitor` case
of the `agent` CLI dispatch.

---

## Task API (Unix Domain Socket)

Tasks running inside Nomad allocations can access the local agent's HTTP API
via UDS at `${NOMAD_SECRETS_DIR}/api.sock`. Authentication is **always**
required (even with ACLs disabled). Use the workload identity token
`$NOMAD_TOKEN`.

```sh
curl --unix-socket "${NOMAD_SECRETS_DIR}/api.sock" \
  -H "Authorization: Bearer ${NOMAD_TOKEN}" \
  localhost/v1/client/metadata
```

- mTLS is never enforced on the UDS path (traffic stays on-node).
- If `task.user` is set in the jobspec, the socket is only accessible by that
  user.
- Windows requires build 17063+.

---

## HCL → JSON Conversion

Submit raw HCL to `/v1/jobs/parse` and receive the canonical JSON job object:

```ts
const jsonJob = await nomad.jobs.parse(hclString, /* canonicalize= */ true);
await nomad.jobs.create({ Job: jsonJob.data });
```

The `validate` CLI command does this automatically when given a `.nomad` or
`.hcl` file path.
