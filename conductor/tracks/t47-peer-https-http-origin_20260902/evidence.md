# T47 部署与验收证据

## Release

- Git SHA：`2a0c4c4e3a7448eaee8a7e05725cfdacdbae09f4`
- Build date：`2026-09-02T13:42:34Z`
- Web：`sha256:216046066c340b5be7354edfeadbc9641f796e6ab40892f4544aed5fe6d6336d`
- Worker：`sha256:31b26718ce70ecd917672f14391151a872eb11796a296a3c52878bd4c73f942f`
- Runner：`sha256:c69bcb3772a329c04fd19f28212124f60da711ae4c516778848fef8e2ccd9065`

Runner component source did not change from `951541aa` to `2a0c4c4e`. Docker Hub base metadata
timed out repeatedly, so the final Runner image was derived from the verified `951541aa` digest by
overriding only OCI revision/build-date and release environment. Parent and child
`RootFS.Layers` were exactly equal.

## Executable topology

```text
public browser -> HTTPS aliyun-sz Caddy --HTTP/Tailscale--> 100.64.0.2:10443
tailnet browser -> HTTPS home Caddy ------HTTP-----------> 100.64.0.2:10443
                                                        -> Compose HTTP :8080
                                                           -> Web / Keycloak
```

- Both Caddy fragments contain `reverse_proxy http://100.64.0.2:10443`.
- Neither UI4A ingress fragment contains an HTTPS upstream.
- Edge port inventory is `100.64.0.2:10443 -> 8080/tcp`; `8443` is not host-published.
- `192.168.1.7:10443` is not bound; unknown Host and public Keycloak admin return 404.
- Runner delivery TLS `8443/9444` and Keycloak admin TLS `9443` remain container-internal.

## State and identity

- `preflight` and `up` completed for the exact release.
- Eight long-running services are healthy.
- Retained volume name hash remained
  `9c1398f8a9f79a648d3ded6b716d8fcd1fa81c42c48724f61a268bc224b13a99`.
- Keycloak realm remains v2; backup-first Web callback reconciliation returned
  `migration=already-applied`, `origins=updated`.
- Browser-origin backup is 0600 at
  `/var/lib/ui4a/realm/backups/t47-browser-origins-20260902T1314Z.json`, SHA-256
  `4006df062ec106c9d0ae04829305f8f71d033ced40cdea8bf6f387a77433dd0f`.
- Both public and internal Authorization Code + PKCE flows completed in isolated browsers; the
  internal callback returned to `https://ui4a.home-linux.tail.styleofwong.com/` while discovery
  retained the unique public issuer.

## HTTP and product acceptance

- Public/internal root: 307 to login without a session.
- Public/internal `/live`: 200; final release SHA and build date match.
- Public business API without a credential: structured 401.
- Public `POST /api/chat` without a session: `401 session_not_found`, not
  `400 request_origin_invalid`.
- Public OIDC discovery/account: 200/302; public admin route remains 404.
- Public authenticated Chat returned 200 after the final provider egress change and correctly
  listed one implementation-ready work item.
- Internal authenticated Chat initially exposed and then verified the canonical self-fetch fix:
  contract reads now traverse `service.publicOrigin`; no internal-host fetch failure remains.
- Local CLI `auth status` and `doctor` passed; health/business/meta probes were all 200.

## Verification gates

- `pnpm check`: 495 test files passed, 8 skipped; 3753 tests passed, 15 skipped.
- `pnpm governance:strict`: passed with empty baselines.
- `pnpm format:check`: passed.
- Caddy config adapted with the deployed digest; Home reload and aliyun-sz full validate/reload
  succeeded.
- External runbook local/Home SHA-256 after final release and egress values:
  `971160c3c25f4abf5e22ca2dff81ee72954304da8b06e24e6bebf849be9b6405`.

## Provider egress resolution

`deepseek-v4-flash` correctly maps to the single API-key-based
`openai-compatibility[name=opencode-go]` provider. Direct `aliyun-sz -> ocgo:9453` TCPing measured
40% loss and second-scale connects; unrelated Kimi refresh warnings initially obscured this fact.
Only this provider's `proxy-url` changed from `direct` to `http://127.0.0.1:10808`. The loopback
sing-box mixed proxy selected `vless[hk-entry]`; no other provider or API key changed. After restart:

- direct OpenCode Go completion through the configured egress: HTTP 200, model/choice/usage valid;
- UI4A Web container completion: HTTP 200, model `deepseek-v4-flash`, choice/usage valid;
- isolated-browser PKCE Chat: HTTP 200 and one real implementation-ready work item.

Config backup:
`/var/lib/cliproxyapi/config.yaml.before-opencode-egress-20260902T141034Z.bak`, SHA-256
`10bb852307f53ee981cf2869edd14926162b39245c41fc9623a787d828a20c3d`. Current config SHA-256:
`9b63ba1fdbe713251bec508b913d479da090e18210b0f0313c5d2110ae2f9a09`.
