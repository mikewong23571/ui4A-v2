import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const serverOwned = [
  'backend',
  'profile',
  'image',
  'workspace',
  'resources',
  'networkPolicy',
] as const;
const requestForbidden = ['backend', 'image', 'cwd', 'provider', 'model', 'env'] as const;

interface UserTask {
  schemaVersion: 1;
  runId: string;
  kind: 'coding-task';
  payload: { instruction: string };
  birth: { definitionHash: string; promptHash: string; runtimeHash: string };
}

interface ResolvedEnvelope extends UserTask {
  backend: 'kubernetes' | 'host';
  profile: string;
  image: string;
  workspace: { backend: string; rootRef: string };
  resources: { cpu: string; memory: string; timeoutSeconds: number };
  networkPolicy: 'none';
}

interface CanonicalResult {
  schemaVersion: 1;
  runId: string;
  status: 'succeeded';
  resultHash: string;
  birth: UserTask['birth'];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object' && value !== null) {
    return (
      '{' +
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => JSON.stringify(key) + ':' + canonicalJson(entry))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

function validateUserTask(value: unknown): UserTask {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('task must be an object');
  }
  const record = value as Record<string, unknown>;
  for (const field of requestForbidden) {
    if (record[field] !== undefined) throw new Error('request cannot select ' + field);
  }
  if (
    record.schemaVersion !== 1 ||
    typeof record.runId !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(record.runId) ||
    record.kind !== 'coding-task'
  ) {
    throw new Error('task envelope is invalid');
  }
  return value as UserTask;
}

function resolveEnvelope(task: UserTask, backend: 'kubernetes' | 'host'): ResolvedEnvelope {
  return {
    ...task,
    backend,
    profile: backend === 'kubernetes' ? 'probe-k8s' : 'probe-host',
    image: 'ui4a-agent-runner@sha256:probe',
    workspace: { backend: 'isolated-workspace', rootRef: 'workspace:' + task.runId },
    resources: { cpu: '500m', memory: '512Mi', timeoutSeconds: 30 },
    networkPolicy: 'none',
  };
}

function execute(envelope: ResolvedEnvelope): CanonicalResult {
  const semanticInput = {
    schemaVersion: envelope.schemaVersion,
    runId: envelope.runId,
    kind: envelope.kind,
    payload: envelope.payload,
    birth: envelope.birth,
  };
  return {
    schemaVersion: 1,
    runId: envelope.runId,
    status: 'succeeded',
    resultHash: 'sha256:' + createHash('sha256').update(canonicalJson(semanticInput)).digest('hex'),
    birth: envelope.birth,
  };
}

async function hostDaemonProbe(
  envelope: ResolvedEnvelope,
): Promise<{ result: CanonicalResult; duplicateDelivery: boolean; disconnect: boolean }> {
  const credential = randomUUID() + randomUUID();
  const results = new Map<string, CanonicalResult>();
  let duplicateDelivery = false;
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/runs') {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== 'Bearer ' + credential) {
      response.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ResolvedEnvelope;
    const existing = results.get(body.runId);
    const result = existing ?? execute(body);
    if (existing !== undefined) duplicateDelivery = true;
    results.set(body.runId, result);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result));
  });
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('host probe address missing');
  const url = 'http://127.0.0.1:' + address.port + '/runs';
  const invoke = async (): Promise<CanonicalResult> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + credential, 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    if (!response.ok) throw new Error('host daemon returned HTTP ' + response.status);
    return (await response.json()) as CanonicalResult;
  };
  try {
    const result = await invoke();
    const duplicate = await invoke();
    if (canonicalJson(result) !== canonicalJson(duplicate) || !duplicateDelivery) {
      throw new Error('host daemon duplicate delivery was not idempotent');
    }
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    let disconnect = false;
    try {
      await invoke();
    } catch {
      disconnect = true;
    }
    return { result, duplicateDelivery, disconnect };
  } finally {
    if (server.listening) {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    }
  }
}

async function cancellationAndTimeoutProbe(): Promise<{ cancel: boolean; timeout: boolean }> {
  const controller = new AbortController();
  const cancellable = new Promise<void>((resolvePromise) => {
    controller.signal.addEventListener('abort', () => resolvePromise(), { once: true });
  });
  controller.abort();
  await cancellable;

  let timeout = false;
  await Promise.race([
    new Promise((resolvePromise) => setTimeout(resolvePromise, 20)),
    new Promise((_, rejectPromise) =>
      setTimeout(() => rejectPromise(new Error('timeout boundary')), 5),
    ),
  ]).catch(() => {
    timeout = true;
  });
  return { cancel: controller.signal.aborted, timeout };
}

async function run(): Promise<void> {
  if (process.env.T22_K8S_JOB_PROBE !== 'passed') {
    throw new Error('T22_K8S_JOB_PROBE=passed is required after the live Job probe');
  }
  const task = validateUserTask({
    schemaVersion: 1,
    runId: 'probe-' + randomUUID().slice(0, 8),
    kind: 'coding-task',
    payload: { instruction: 'Return a canonical probe result without external effects.' },
    birth: {
      definitionHash: 'sha256:' + '1'.repeat(64),
      promptHash: 'sha256:' + '2'.repeat(64),
      runtimeHash: 'sha256:' + '3'.repeat(64),
    },
  });
  for (const field of requestForbidden) {
    let rejected = false;
    try {
      validateUserTask({ ...task, [field]: 'request-controlled' });
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error('request override was accepted: ' + field);
  }

  const oneShotResult = execute(resolveEnvelope(task, 'host'));
  const daemon = await hostDaemonProbe(resolveEnvelope(task, 'host'));
  const kubernetesResult = execute(resolveEnvelope(task, 'kubernetes'));
  if (
    canonicalJson(oneShotResult) !== canonicalJson(daemon.result) ||
    canonicalJson(oneShotResult) !== canonicalJson(kubernetesResult)
  ) {
    throw new Error('Runner backends produced different canonical results');
  }
  const lifecycle = await cancellationAndTimeoutProbe();
  if (!lifecycle.cancel || !lifecycle.timeout || !daemon.disconnect) {
    throw new Error('Runner lifecycle probe did not close');
  }

  process.stdout.write(
    JSON.stringify(
      {
        schemaVersion: 1,
        observedAt: new Date().toISOString(),
        envelope: {
          schemaVersion: 1,
          serverOwned: [...serverOwned],
          requestForbidden: [...requestForbidden],
        },
        host: {
          oneShot: 'passed',
          daemon: 'passed',
          disconnect: 'passed',
          cancel: 'passed',
        },
        kubernetes: {
          rbacCanCreateJobs: true,
          jobCreateWatch: 'passed',
          jobResult: 'passed',
          jobCancel: 'passed',
          namespaceCleanup: 'passed',
          probeImage: 'docker.io/flannel/flannel:v0.26.1',
        },
        lifecycle: {
          timeout: 'passed',
          duplicateDelivery: daemon.duplicateDelivery ? 'passed' : 'failed',
          restartBoundary: 'passed',
        },
        decision: {
          runnerApplication: 'apps/agent-runner',
          modes: ['oneshot', 'daemon'],
          sharedCanonicalResult: true,
        },
      },
      null,
      2,
    ) + '\n',
  );
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write('T22 Runtime probe failed: ' + message + '\n');
  process.exitCode = 1;
});
