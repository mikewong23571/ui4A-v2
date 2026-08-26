import type { SurfaceNode, SurfaceTree } from '../surface/index';

export interface RecipeRegionSlot {
  name: string;
}

const SLOT_SUBJECT = /^\$slot:([a-zA-Z0-9_.-]+)$/;

function nodeSubjects(node: SurfaceNode): string[] {
  const subjects = node.dependencies.flatMap((dependency) =>
    dependency.kind === 'entity' ? [dependency.subject] : [],
  );
  if (node.kind === 'word') {
    subjects.push(
      ...Object.values(node.bindings).flatMap((binding) =>
        binding.kind === 'item' ? [] : [binding.subject],
      ),
    );
  } else if (node.kind === 'repeat') {
    subjects.push(node.source.subject, ...nodeSubjects(node.item));
  } else if (node.kind === 'layout') {
    subjects.push(...node.children.flatMap(nodeSubjects));
  } else if (node.kind === 'slot') {
    subjects.push(...nodeSubjects(node.child));
  }
  return subjects;
}

/** Validate the D45 canonical root layout and each region's slot-local subject references. */
export function canonicalRecipeSlotIssues(
  surface: SurfaceTree,
  slots: readonly RecipeRegionSlot[],
): string[] {
  const root = surface.root;
  if (root.kind !== 'layout') {
    return ['recipe surface must use a canonical layout root with ordered region slots'];
  }
  if (
    root.children.length !== slots.length ||
    root.children.some((child, index) => child.kind !== 'slot' || child.name !== slots[index]?.name)
  ) {
    return ['recipe root region slots must match the complete ordered declared slot shape'];
  }
  const issues: string[] = [];
  if (root.dependencies.some((dependency) => dependency.kind === 'entity')) {
    issues.push('recipe layout root cannot own a region entity subject');
  }
  root.children.forEach((child, index) => {
    if (child.kind !== 'slot') return;
    const expected = slots[index]!.name;
    const subjects = nodeSubjects(child);
    if (subjects.length === 0) {
      issues.push(`recipe region "${expected}" must reference $slot:${expected}`);
      return;
    }
    for (const subject of subjects) {
      if (SLOT_SUBJECT.exec(subject)?.[1] !== expected) {
        issues.push(`recipe region "${expected}" must reference only $slot:${expected}`);
        break;
      }
    }
  });
  return issues;
}
