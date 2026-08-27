# T22 Mothership Platform Probe

## Result

The target cluster is reachable and healthy enough to begin design work, but it does not yet provide
stateful application storage or UI4A image artifacts. This is a read-only observation, not deployment
evidence.

Observed at: 2026-08-24 02:42:33 UTC.

All internal HTTP probes ran after unsetting:

```bash
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY
unset http_proxy https_proxy all_proxy no_proxy
```

## Cluster

| Node | Role | Ready | Allocatable | Root filesystem | Data disk |
|---|---|---:|---|---|---|
| k8s-cp-1 | control-plane, NoSchedule | yes | 4 CPU / 8029388 Ki / 110 pods | 58 GiB, 13% used | vdb 100 GiB, unformatted |
| k8s-w-1 | worker | yes | 4 CPU / 8029388 Ki / 110 pods | 58 GiB, 10% used | vdb 100 GiB, unformatted |
| k8s-w-2 | worker | yes | 4 CPU / 8029396 Ki / 110 pods | 58 GiB, 9% used | vdb 100 GiB, unformatted |

- Kubernetes client/server: v1.31.14.
- containerd on all nodes: 2.2.1.
- Istiod image: `docker.io/istio/pilot:1.24.2`.
- Helm: v3.16.3.
- No non-Running/non-Succeeded Pods were found.
- The current credential can create namespaces, Jobs, cluster PVs, and Istio Gateways. These
  `kubectl auth can-i` checks do not authorize mutation during the probe.

## Storage

Live cluster results:

```text
StorageClass: none
PersistentVolume: none
PersistentVolumeClaim: none
```

Each VM has an unused, unformatted 100 GiB `vdb`. Two viable candidates remain:

1. `static-local-pv` — recommended for this bounded experimental release because it needs no
   controller image and makes node affinity/data placement explicit.
2. `local-path-provisioner` — easier dynamic claims but adds a controller/image and still does not
   create HA storage.

Formatting or mounting `vdb` is intentionally deferred. Before that destructive step, the
implementation must re-check device identity, filesystem signatures, mounts, and target paths on
each exact node.

## Istio ingress

Existing Gateways:

- `gateway-demo/demo-gateway`
- `mattermost/mattermost-gateway`

The shared `istio-ingressgateway` exposes:

| Port | Service port | NodePort |
|---|---:|---:|
| status-port | 15021 | 30486 |
| http2 | 80 | 31534 |
| https | 443 | 32067 |

Existing internal hosts include `chat.mothership.internal` and
`panel.mothership.internal`. T22 may add `ui4a.mothership.internal` and
`auth.ui4a.mothership.internal` without creating a second ingress controller.

## PKI

The repository contains the public certificate for `CN=Mothership Internal CA`, valid until
2036-08-03, fingerprint:

```text
DC:E8:F0:5A:A3:A9:11:F7:00:0C:88:46:D8:7B:7C:2C:B6:B4:B6:88:67:2D:74:21:46:47:AC:27:15:92:94:07
```

A different `mothership-panel-ca.key` exists under `/etc/mothership/pki`, but its public key does
not match the repository's Mothership Internal CA certificate. No matching private key was located.
T22 therefore must either locate the original key before signing or generate and persist a dedicated
UI4A experimental CA; it must not overwrite either existing CA.

## Internal image sources

Nexus advertises `daocloud`, `docker-quay`, `docker-hosted`, and other Docker repositories.
Manifest probes produced:

| Component | Source probe | Result |
|---|---|---|
| Node | daocloud / library/node:24-bookworm-slim | HTTP 200 |
| PostgreSQL | daocloud / library/postgres:17-alpine | HTTP 200 |
| Temporal Server | daocloud / temporalio/server:latest | HTTP 200 |
| Temporal UI | daocloud / temporalio/ui:latest | cold-cache timeout at 8 seconds |
| Keycloak | docker-quay / keycloak/keycloak:latest | HTTP 200 |
| UI4A Agent Runtime | docker-hosted | image must be built; push credentials not probed |

`latest` was used only to establish repository reachability. Exact immutable versions and digests
remain decisions for the relevant disposable probes; production manifests must not use `latest`.

Direct Docker Hub pull from the development host failed. UI4A images and dependencies must use the
internal Nexus/cache/export path.

## Image distribution constraints

All three nodes currently contain the same Flannel 0.26.1 and Istio 1.24.2 images. The live cache plus
the target runbook confirm the established procedure:

- pull with `ctr --all-platforms --hosts-dir /etc/containerd/certs.d`;
- export once, distribute internally, and import on other nodes;
- preserve the official image name expected by kubelet;
- use `imagePullPolicy: IfNotPresent`.

The import step was not replayed during this read-only probe because it mutates containerd state. It
must be replayed with UI4A release images during Phase H.

## Repository ownership constraint

`mothership-setup` already has modified and untracked work, including its K8s documentation and
`deploy/` tree. T22 must:

- preserve all existing changes;
- add only the scoped `deploy/ui4a/` integration and explicit documentation links;
- keep UI4A and mothership commits separate;
- record both repository SHAs in acceptance evidence.

## Commands used

```bash
ssh k8s-cp-1 kubectl version -o json
ssh k8s-cp-1 kubectl get nodes -o wide
ssh k8s-cp-1 kubectl get storageclass
ssh k8s-cp-1 kubectl get pv
ssh k8s-cp-1 kubectl get pvc -A
ssh k8s-cp-1 kubectl get gateway,virtualservice -A
ssh k8s-cp-1 kubectl -n istio-system get svc istio-ingressgateway
ssh k8s-cp-1 kubectl -n istio-system get deploy istiod
ssh k8s-cp-1 helm version --short
ssh k8s-cp-1 containerd --version
ssh k8s-w-1 containerd --version
ssh k8s-w-2 containerd --version
```

The machine-readable facts are in [platform-probe.json](./platform-probe.json).
