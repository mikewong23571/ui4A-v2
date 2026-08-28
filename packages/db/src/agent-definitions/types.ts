import type {
  AgentDefinitionRef,
  AgentDefinitionSource,
  ContentHash,
  FlattenedAgentDefinitionArtifact,
  JsonValue,
  PromptTemplate,
} from '@ui4a/shared';
import type { PoolClient } from 'pg';

import { ensureEventsTable, type DbExecutor } from '../events';

export const AGENT_DEFINITION_DDL = `
CREATE TABLE IF NOT EXISTS agent_definition_payloads (
  payload_hash              TEXT PRIMARY KEY,
  media_type                TEXT NOT NULL DEFAULT 'application/json',
  canonicalization_version  INTEGER NOT NULL DEFAULT 1,
  byte_length               INTEGER NOT NULL,
  payload                   JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_definition_versions (
  principal           TEXT NOT NULL,
  policy_scope        TEXT NOT NULL,
  definition_name     TEXT NOT NULL,
  definition_version  INTEGER NOT NULL,
  definition_ref      TEXT NOT NULL,
  status              TEXT NOT NULL,
  source_hash         TEXT NOT NULL REFERENCES agent_definition_payloads(payload_hash),
  flattened_hash      TEXT NOT NULL REFERENCES agent_definition_payloads(payload_hash),
  template_hash       TEXT NOT NULL REFERENCES agent_definition_payloads(payload_hash),
  evaluation_hash     TEXT NOT NULL REFERENCES agent_definition_payloads(payload_hash),
  parent_ref          TEXT,
  registered_actor    TEXT NOT NULL,
  registered_seq      BIGINT NOT NULL,
  activated_seq       BIGINT,
  deprecated_seq      BIGINT,
  updated_seq         BIGINT NOT NULL,
  PRIMARY KEY (principal, policy_scope, definition_name, definition_version),
  UNIQUE (principal, policy_scope, definition_ref)
);

CREATE TABLE IF NOT EXISTS agent_definition_active (
  principal           TEXT NOT NULL,
  policy_scope        TEXT NOT NULL,
  definition_name     TEXT NOT NULL,
  active_version      INTEGER NOT NULL,
  activated_seq       BIGINT NOT NULL,
  PRIMARY KEY (principal, policy_scope, definition_name),
  FOREIGN KEY (principal, policy_scope, definition_name, active_version)
    REFERENCES agent_definition_versions
      (principal, policy_scope, definition_name, definition_version)
);

CREATE INDEX IF NOT EXISTS agent_definition_versions_scope
  ON agent_definition_versions (principal, policy_scope, definition_name, definition_version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS agent_definition_event_id_unique
  ON events ((detail->>'eventId'))
  WHERE domain='agent-definition' AND detail ? 'eventId';
CREATE UNIQUE INDEX IF NOT EXISTS agent_definition_command_id_unique
  ON events ((detail->>'commandId'))
  WHERE domain='agent-definition' AND detail ? 'commandId';

CREATE OR REPLACE FUNCTION agent_definition_payloads_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'agent_definition_payloads append-only: % is forbidden for %',
    TG_OP, OLD.payload_hash;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_definition_payloads_append_only_trigger ON agent_definition_payloads;
CREATE TRIGGER agent_definition_payloads_append_only_trigger
  BEFORE UPDATE OR DELETE ON agent_definition_payloads
  FOR EACH ROW EXECUTE FUNCTION agent_definition_payloads_append_only();
`;

export interface ConnectableDb extends DbExecutor {
  connect?: () => Promise<PoolClient>;
}

export interface AgentDefinitionContentRefs {
  source: ContentHash;
  flattened: ContentHash;
  template: ContentHash;
  evaluation: ContentHash;
}

export interface AgentDefinitionVersionRecord {
  schemaVersion: 1;
  ref: AgentDefinitionRef;
  name: string;
  version: number;
  principal: string;
  policyScope: string;
  status: 'registered' | 'active' | 'deprecated';
  content: AgentDefinitionContentRefs;
  flattenedHash: ContentHash;
  parentRef?: AgentDefinitionRef;
  registeredActor: string;
  registeredSeq: number;
  activatedSeq?: number;
  deprecatedSeq?: number;
  updatedSeq: number;
}

export interface AgentDefinitionVersionView {
  version: AgentDefinitionVersionRecord;
  source: AgentDefinitionSource;
  flattened: FlattenedDefinitionPayload;
  template: PromptTemplate;
  evaluation: JsonValue;
}

export interface AgentDefinitionRegistrySnapshot {
  definitions: ReadonlyMap<
    AgentDefinitionRef,
    { status: 'draft' | 'active' | 'deprecated'; source: AgentDefinitionSource }
  >;
  activeByName: ReadonlyMap<string, AgentDefinitionRef>;
}

export interface FlattenedDefinitionPayload {
  schemaVersion: 1;
  ref: AgentDefinitionRef;
  derivedFrom?: FlattenedAgentDefinitionArtifact['derivedFrom'];
  definition: FlattenedAgentDefinitionArtifact['definition'];
}

export interface RegistrationEventDetail {
  eventId: string;
  commandId: string;
  actor: string;
  principal: string;
  policyScope: string;
  version: Omit<AgentDefinitionVersionRecord, 'registeredSeq' | 'updatedSeq'>;
}

export interface ActivationEventDetail {
  eventId: string;
  commandId: string;
  actor: string;
  principal: string;
  policyScope: string;
  ref: AgentDefinitionRef;
  name: string;
  version: number;
  expectedActiveVersion: number | null;
}

export interface DeprecationEventDetail {
  eventId: string;
  commandId: string;
  actor: string;
  principal: string;
  policyScope: string;
  ref: AgentDefinitionRef;
  name: string;
  version: number;
}

export type AgentDefinitionStoredEvent =
  | { seq: number; kind: 'agent-definition-version-registered'; detail: RegistrationEventDetail }
  | { seq: number; kind: 'agent-definition-version-activated'; detail: ActivationEventDetail }
  | { seq: number; kind: 'agent-definition-version-deprecated'; detail: DeprecationEventDetail };

export async function ensureAgentDefinitionTables(db: DbExecutor): Promise<void> {
  await ensureEventsTable(db);
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(740940)');
    await db.query(AGENT_DEFINITION_DDL);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

/** SHA-256 over the same recursively sorted JSON representation used by the pure definition kernel. */
