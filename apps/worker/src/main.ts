import { formatHeartbeat, nextDelayMs, shutdownMessage, startupMessage } from './heartbeat';

const HEARTBEAT_INTERVAL_MS = 3000;

console.log(startupMessage(HEARTBEAT_INTERVAL_MS));

let tick = 0;
const timer = setInterval(
  () => {
    tick += 1;
    console.log(formatHeartbeat(tick));
  },
  nextDelayMs(tick, HEARTBEAT_INTERVAL_MS),
);

function shutdown(signal: NodeJS.Signals): void {
  clearInterval(timer);
  console.log(shutdownMessage(signal));
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
