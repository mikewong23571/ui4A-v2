# T47 Disposable HTTP Origin Probe

## Question

Can Home publish one HTTP-only container listener exclusively on its Tailscale address so that
Home and `aliyun-sz` can reach it without opening the same port on the LAN?

## Procedure

- Reused the exact deployed Caddy image digest in a disposable `ui4a-http-spike` container.
- Published `100.64.0.2:11080 -> container:8080` only.
- Requested it from Home, `aliyun-sz` (`100.64.0.8`) and Home LAN address `192.168.1.7`.
- Inspected the listening socket and Caddy access log, then removed the container and confirmed the
  listener disappeared.

## Result

- Home request: HTTP 200.
- `aliyun-sz` request over Tailscale: HTTP 200.
- Home LAN address: connection refused; the socket was bound only to `100.64.0.2:11080`.
- The container was removed and port 11080 no longer listened.

Docker's published-port NAT presented the remote `aliyun-sz` request to the container as bridge source
`172.17.0.1`, not `100.64.0.8`. Therefore an application-container `remote_ip` matcher cannot implement
a trustworthy Tailnet-node allowlist. The final design uses the host bind to the Tailscale address as
the network boundary; optional per-node restriction belongs in the Tailnet ACL/host firewall before
Docker NAT, not in the HTTP gateway. The exposed HTTP listener carries only the same authenticated,
allowlisted UI/realm surface already exposed by HTTPS; admin and internal listeners remain unpublished.
