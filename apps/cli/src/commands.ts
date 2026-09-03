import type { ParsedArgs } from './args.js';
import { runAuditCommand } from './commands-audit.js';
import { runBundleCommand } from './commands-bundles.js';
import { runBusinessCommand } from './commands-business.js';
import { runDiscoverCommand } from './commands-discover.js';
import { runDraftCommand } from './commands-drafts.js';
import { CliError, type SuccessEnvelope } from './envelope.js';
import type { Ui4aHttpClient } from './http.js';
import { CLI_RELEASE_TAG } from './release.js';

export const HELP = `ui4a ${CLI_RELEASE_TAG} (experimental) — UI4A HTTP/Siren/meta reference client

Usage: ui4a [--json] [--base-url URL] [--scope APPLICATION] <noun> <verb> [arguments]

Discover and read:
  auth login|status|logout            Manage long-lived Device credential
  doctor                              Check endpoint, protocol and auth source
  apps list | apps show <name>        Discover authorized Applications
  flows list | flows show <name>      Discover active Flows
  entities get|resolve <rel>           Read exact Siren Entity and live actions
  catalog list                         Read registered capabilities
  audit <session|entity|definition|draft> <id> [--after-seq N] [--limit N]

Business operations:
  actions list <rel>
  actions exec <rel> <action> --params JSON|--params-file FILE [--dry-run]
  plans submit --file FILE

Definition Bundles and governed Drafts:
  (--scope APPLICATION declares the meta-plane application lens; Draft writes
  require it, and the server only honors a scope the credential already grants)
  bundles export <application> [--out FILE]
  bundles validate --file FILE
  bundles diff --before FILE --after FILE
  drafts create --kind KIND --target NAME --payload-file FILE [--command-id ID]
                 (KIND: flow-definition | agent-definition | application-bundle)
  drafts get|diff|validate|submit|abandon <draft-id> [options]
  drafts list [--status STATUS] [--limit N]
  drafts revise <draft-id> --base-version N --payload-file FILE [--target-base-version N]
  drafts watch <draft-id> [--after-seq N]
  activations get|watch <activation-rel>

Read-only escape hatch:
  request get|head <same-origin-path>

Safety: the CLI has no LLM, approve/reject command, --actor, --principal, --no-draft, or raw write.
Identity is credential-derived in production. Current local demo is explicitly self-reported.
`;

export async function runCommand(
  args: ParsedArgs,
  client: Ui4aHttpClient,
): Promise<SuccessEnvelope> {
  const handled =
    (await runDiscoverCommand(args, client)) ??
    (await runBusinessCommand(args, client)) ??
    (await runBundleCommand(args, client)) ??
    (await runDraftCommand(args, client)) ??
    (await runAuditCommand(args, client));
  if (handled !== undefined) return handled;
  throw new CliError('USAGE', 'unknown command; run ui4a --help', 2);
}
