import {
  releaseMetadata,
  runDaemon,
  runnerLivePayload,
  unavailableOneshotMessage,
} from './runtime.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'daemon';
  if (command === '--version' || command === 'version') {
    console.log(JSON.stringify(releaseMetadata()));
    return;
  }
  if (command === 'health') {
    console.log(JSON.stringify(runnerLivePayload()));
    return;
  }
  if (command === 'oneshot') {
    console.error(JSON.stringify({ status: 'unavailable', reason: unavailableOneshotMessage() }));
    process.exitCode = 78;
    return;
  }
  if (command === 'daemon') {
    await runDaemon();
    return;
  }
  throw new Error(`unknown runner command: ${command}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ status: 'failed', reason: message }));
  process.exit(1);
});
