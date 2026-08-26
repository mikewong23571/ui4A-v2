export const SURFACE_SCHEMA_VERSION = 1 as const;
export const SEMANTIC_REGION_ROLES = [
  'identity',
  'status',
  'primary-content',
  'metadata',
  'relation',
  'actions',
  'diagnostic',
] as const;

export type SemanticRegionRole = (typeof SEMANTIC_REGION_ROLES)[number];
export type SurfaceLayout = 'stack' | 'grid' | 'inline';
export type SurfaceBindingKind = 'property' | 'actions' | 'links' | 'entities' | 'item';
export type SurfaceBinding =
  | { kind: 'property'; subject: string; path: string }
  | { kind: 'actions'; subject: string }
  | { kind: 'links'; subject: string }
  | { kind: 'entities'; subject: string }
  | { kind: 'item'; path: string };

export interface SurfaceDependency {
  kind: 'entity' | 'definition' | 'catalog';
  subject: string;
  version: string;
  paths?: string[];
}

export interface SurfaceProvenance {
  kind:
    | 'application-recipe'
    | 'presentation-agent'
    | 'generic-fallback'
    | 'human-patch'
    | 'composition-declaration'
    | 'validator';
  ref: string;
  model?: string;
}

interface SurfaceNodeBase {
  id: string;
  role: SemanticRegionRole;
  dependencies: SurfaceDependency[];
  provenance: SurfaceProvenance[];
}

export interface SurfaceLayoutNode extends SurfaceNodeBase {
  kind: 'layout';
  layout: SurfaceLayout;
  children: SurfaceNode[];
}

export interface SurfaceSlotNode extends SurfaceNodeBase {
  kind: 'slot';
  name: string;
  child: SurfaceNode;
}

export interface SurfaceRepeatNode extends SurfaceNodeBase {
  kind: 'repeat';
  source: Extract<SurfaceBinding, { kind: 'entities' }>;
  item: SurfaceNode;
}

export interface SurfaceWordNode extends SurfaceNodeBase {
  kind: 'word';
  word: string;
  bindings: Record<string, SurfaceBinding>;
}

/** Trusted validator output. It intentionally contains no binding or executable control. */
export interface SurfaceDiagnosticNode extends SurfaceNodeBase {
  kind: 'diagnostic';
  code: string;
  failedNodeId?: string;
}

export type SurfaceNode =
  SurfaceLayoutNode | SurfaceSlotNode | SurfaceRepeatNode | SurfaceWordNode | SurfaceDiagnosticNode;

export interface SurfaceTree {
  schemaVersion: typeof SURFACE_SCHEMA_VERSION;
  root: SurfaceNode;
}

export interface SurfaceCatalogBinding {
  sources: SurfaceBindingKind[];
  required?: boolean;
}

export interface SurfaceCatalogWord {
  roles: SemanticRegionRole[];
  bindings: Record<string, SurfaceCatalogBinding>;
  /** Optional semantic composition pattern; never a React/component name. */
  pattern?: 'member-link';
}

export interface SurfaceCatalog {
  id: string;
  version: string;
  words: Record<string, SurfaceCatalogWord>;
}

export interface SurfaceCatalogValidationResult {
  valid: boolean;
  errors: string[];
}

export type SurfaceIssueCode =
  | 'surface-invalid'
  | 'node-invalid'
  | 'node-id-duplicate'
  | 'binding-invalid'
  | 'unknown-binding'
  | 'required-binding-missing'
  | 'binding-source-invalid'
  | 'dependency-invalid'
  | 'dependency-missing'
  | 'catalog-invalid'
  | 'catalog-dependency-invalid'
  | 'unknown-word'
  | 'word-role-invalid'
  | 'serialization-invalid';

export interface SurfaceValidationIssue {
  code: SurfaceIssueCode;
  nodeId: string;
  path: string;
  message: string;
}

export interface SurfaceValidationResult {
  valid: boolean;
  surface: SurfaceTree;
  issues: SurfaceValidationIssue[];
}

export interface GenericSurfaceOptions {
  entityVersion: string;
  semanticHints?: Readonly<Record<string, SemanticRegionRole>>;
  provenanceRef?: string;
}
