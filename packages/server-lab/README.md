# Server P0 laboratory

This private package contains executable boundary experiments for [S0](../../docs/21-s0-acceptance.md). It is **not a server product**, is not included in the ORYH Profile, and does not enable production mode. It has no browser shell, model loop, login service, or deployed ORYH integration. The transport tests now compose the actual public Harness WebServer/Connection/Gateway and serve its built frontend, without copying its UI.

## Run

From the repository root, with the normal development dependencies installed:

```sh
pnpm --filter @oryh/server-lab build
pnpm --filter @oryh/server-lab test
# Explicit Docker experiment; uses the already-installed image, never pulls implicitly.
pnpm --filter @oryh/server-lab probe:docker
# Or all three:
pnpm server:p0
```

Default image: local `node:24-bookworm-slim`, resolved to an immutable image ID before execution. Set `ORYH_P0_IMAGE` to another installed compatible Node 24 image if needed. Docker must be running.

The probe creates one trusted synthetic broker and four execution containers (A1, A2, B1, B3), each with only its own Unix socket volume, no network, no capabilities, a non-root user, a read-only root and code mount, and bounded resources. The broker creates synthetic credentials internally. Real user files, API keys, business endpoints, Profile directories and Docker socket are never mounted. It cleans up only its randomly named, labelled resources; cleanup failures print their names for inspection. SIGKILL/host failure may require manual cleanup of resources labelled `oryh.p0`.

## What is implemented

- A trusted in-memory owner/generation registry and a private execution socket per channel. Caller-supplied identities, credentials, target URLs and management methods are rejected.
- Synthetic one-shot grants bound to operation content/owner/generation/expiry. Only control-plane test code can issue them; execution sockets cannot approve, reconcile, advance or revoke.
- Operation receipts, duplicate write suppression, pending/unknown result handling and trusted reconciliation. A read always calls upstream again.
- A trusted atomic skill snapshot publisher: path/content/owner/hash validation, serialized publication, current-pointer rename and retained pinned versions. Published files must be mounted read-only in a real executor.
- Real Docker assertions for owner-specific capability mounts, privilege/network restrictions, denied management/credential access, old generations and revocation.

The synthetic transport only records actor/operation IDs. It returns no business bodies; upstream errors are never passed through. This is intentionally narrower than a general HTTP proxy.

## Limits: do not promote these fixtures to production

- The broker receipt/grant/lease state is **in memory**. It does not survive crashes and is not a transactional database adapter. Duplicate suppression here does not prove ORYH idempotency.
- Grants come from trusted fixture code, not a real browser/Harness approval. They are not bound to a real Session. Full user confirmation is an unpassed P0 gate.
- The socket mount binds owner/generation only. Workload attestation and run/Session identity for a shared owner runtime remain to be designed and tested.
- The snapshot publisher serializes only within one object; no cross-process lease, fsync durability, version garbage collection or authenticated ORYH manifest is implemented. It is not wired into desktop skill installation.
- The original four-owner execution containers run direct Node probes, **not Harness**; the additional Shell probe loads real public Harness services in the trusted Host. Full browser/Profile composition, model streaming, complete background-job lifecycle, Linux Harness packaging and active-load capacity remain unverified.
- No business/model response filtering, OAuth refresh lifecycle, real network proxy or credential-free ORYH bundle is implemented.
- The main `developmentOnly` guard remains unchanged. The P0 matrix must pass before starting P1.

## Additional evidence tools

`pnpm server:p0:inventory` reads built generated descriptors and records commit/lock/patch/declaration hashes. It does not inspect user Profiles or credentials and does not automatically pass any gate.

`pnpm server:p0:cold-build` creates fresh local clones of the **committed** Client/Harness baseline and applies the committed compatibility patch. It runs frozen installs, Harness build and Client verify. It does not include uncommitted changes, install a Profile, open a browser or modify the source checkouts. Logs and report remain in the printed temporary directory for diagnosis; clean that directory after retaining the evidence you need. Build-time environment/cache may be reused, so this is a fresh checkout/dependency tree check, not an air-gapped or cache-independent reproducibility proof.


## Native transport and isolated Shell follow-up

Ordinary tests now include actual public Cordis/Connection/WebServer/FrontendStatic/Gateway composition, two owner-specific subdomain routes, native built assets, authenticated test Fetch routes, the real mux WebSocket handshake/ping/reconnect, lease expiry/revocation and Origin checks. The proxy does not parse private mux frames. Fixture streams/downloads are synthetic; full Remote calls, Profile boot, browser rendering and active-content preview are not claimed.

`pnpm server:p0:shell` (root) builds and runs an explicit Docker probe using a subclass of public `LocalBashExecutor`. The trusted Host owns local subprocess management; scripts execute in separately created containers. Workspace paths are confined after realpath resolution, including macOS `/var` aliases. Only a test Workspace is mounted. The probe checks file write, cwd, exit code, stdin, child-process timeout, active cancellation, and an already-aborted request.

Background `start()` intentionally returns a killed result with a clear unsupported message. Environment forwarding and per-call sandbox policy are rejected until their semantics are implemented. Container creation has its own bounded infrastructure timeout; the public foreground timeout applies to the attached execution phase. Daemon loss and Host crash orphan cleanup still need a persistent manager. This provider is not enabled in the application Profile.

The new browser proxy is loopback-only and uses trusted test-issued in-memory leases. It is neither OAuth nor a general-purpose production reverse proxy. See [ADR-0011](../../docs/adr/0011-server-trusted-host-and-isolated-shell.md) for the selected P0 trust boundary.

## Remote MCP skills probe

`mcp-skills.ts` mounts a public Harness Skill Provider and read-only reference tool. `mcp-reader.ts` uses the public MCP SDK Streamable HTTP client with a trusted, fixed endpoint and credential callback. No credential or business-write API is exposed to the provider. Tests exercise real Cordis registration/disposal and real SDK HTTP against an isolated local fixture, not deployed ORYH.

Before product activation, wire owner lifecycle, OAuth refresh/revocation, provider refresh at turn boundaries, and connection cleanup; verify confirmation policy before enabling native MCP business tools. The reader's content-size check happens after decoding, not as a transport byte budget. This remains a P0 component, absent from the shipped Profile.

## OAuth coordinator probe

`oauth.ts` implements single-process PKCE transactions, browser binding, authenticated identity, public Harness credential records, serialized refresh and local disconnect. `connectSkills(grant)` pins the MCP endpoint to the grant's issuer and supplies rotating credentials outside the skill/model interface. Tests include concurrent callbacks, 20 concurrent refresh callers, logout races and a real SDK MCP fixture connection.

This is not an HTTP login service. Browser Cookie/session routes, cross-process transactions, durable grant restoration, encrypted server credential storage and deployed OAuth remain pending. Local disconnect does not revoke ORYH's remote grant: its current metadata advertises no OAuth revocation endpoint.

## Browser login routes probe

`login-routes.ts` registers OAuth/login/session/logout/metadata routes on the public Harness WebServer and removes them through Cordis disposal. Browser cookies are host-only, HttpOnly, Secure and SameSite=Lax; the server binds sessions to authenticated grants and cancellable owner/generation runtime leases. Protected routing receives that trusted binding through `authorize`, not browser-supplied identity.

HTTP tests use the real Harness server with synthetic OAuth/runtime providers. TLS, a real browser Cookie jar, the actual owner runtime pool, control-domain to runtime-domain handoff and complete Profile/Gateway admission remain unverified. These routes are still absent from the product Profile. The runtime lease factory must honor cancellation and release idempotently.

## Owner runtime pool and real native Host probe

`runtime-pool.ts` deduplicates concurrent starts, counts independent leases, bounds live capacity, reclaims idle owners and prevents replacement before cleanup. Failed cleanup quarantines an owner. A shared runtime has no stored browser OAuth grant; each browser retains its own grant and lease. Private target resolution rejects forged or expired lease objects.

`native-runtime.ts` starts real public Harness WebServer/Connection/Gateway/FrontendStatic in separate Cordis contexts with separate synthetic credential stores. Pool tests and login-route tests access these actual HTTP services. This proves lifecycle/composition, **not process/container isolation or a complete product Profile**. Durable Workspace/Session, real credential storage, owner subprocesses, fair admission queues and browser-domain handoff remain pending.

## Subprocess Host and persistent Workspace probe

`process-runtime.ts` launches a fixed compiled worker with scrubbed environment and private owner directories; `process-worker.ts` hosts the public native composition. An exclusive directory lock prevents two supervisors opening one owner root. Startup/exit are supervised, internal cookies travel only over IPC, and a child exit invalidates its pool generation.

The optional persistent composition uses public Harness JSON storage, Session JSONL persistence and WorkspaceRegistry. Tests verify stable native Workspace identity across both graceful restart and forced child exit. They do not yet prove persisted conversation history or the complete ORYH Profile. Same-UID subprocesses are not a sandbox for untrusted code; no tenant scripts/plugins are loaded. Stale locks require verified recovery, not automatic age-based removal.

The package test command builds first so worker tests cannot silently use stale compiled code.

## Session recovery and Profile audit

The synthetic session probe uses public persistence handles, including the durability barrier, and tests exact user/assistant event recovery after normal restart and SIGKILL. It is not a chat endpoint or model-loop implementation. Production acquisition belongs to the native agent loop.

`node packages/server-lab/probes/profile-audit.mjs <report.json>` resolves a temporary base/web/ORYH Profile with public app-boot APIs, excluding user patches and environment files. It saves only plugin IDs, names and disabled flags. Static composition is not runtime preset expansion or full Profile activation; see `docs/29-server-profile-integration.md`.


The experimental `cordis.patch.yml` bundle is loaded by the public Harness Profile/Loader in tests. Its `profile-plugin` export requires a trusted `oryhServerAuthority` service and explicitly configured Session persistence. It exposes only an internal Host Agent factory capability, not a browser API or deployable server command. See docs/27 batch 12 for the tested lifecycle and remaining browser integration.
