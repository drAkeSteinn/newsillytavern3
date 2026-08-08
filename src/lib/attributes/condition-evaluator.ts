// ============================================
// Shared Attribute Condition Evaluator
// ============================================
//
// Evaluates a comparison between an attribute value and a compare value using
// one of the AttributeComparator operators ('<', '<=', '>', '>=', '==', '!=',
// 'contains', 'not_contains').
//
// This logic is shared between:
//   - Lorebook attribute entries (src/lib/lorebook/attribute-resolver.ts)
//   - Proactive attribute conditions (src/lib/proactive/case-selector.ts)
//
// Keeping it in a single place guarantees consistent numeric/string handling
// and case-insensitive text comparison across both subsystems.

import type { AttributeComparator } from '@/types';

/**
 * Evaluates whether `attrValue` satisfies `operator` against `compareValue`.
 *
 * Semantics:
 * - 'contains' / 'not_contains': case-insensitive substring test (text).
 * - Numeric operators ('<', '<=', '>', '>=', '==', '!='): if BOTH values parse
 *   as numbers, numeric comparison is used; otherwise text comparison for
 *   '=='/'!=' (and numeric operators return false on non-numeric text).
 * - When an attribute is stored as a numeric string (e.g. "42") and the compare
 *   value is also numeric, numeric comparison is used.
 *
 * This mirrors exactly the behavior that lived in attribute-resolver.ts so
 * existing lorebook attribute entries keep working identically.
 */
export function evaluateCondition(
  attrValue: number | string | null | undefined,
  operator: AttributeComparator,
  compareValue: number | string
): boolean {
  // Null/undefined attribute never matches any condition.
  if (attrValue === null || attrValue === undefined) {
    return false;
  }

  // String operators (always case-insensitive)
  if (operator === 'contains') {
    return String(attrValue).toLowerCase().includes(String(compareValue).toLowerCase());
  }

  if (operator === 'not_contains') {
    return !String(attrValue).toLowerCase().includes(String(compareValue).toLowerCase());
  }

  // Try numeric comparison first
  const numAttr = typeof attrValue === 'number' ? attrValue : parseFloat(String(attrValue));
  const numComp = typeof compareValue === 'number' ? compareValue : parseFloat(String(compareValue));
  const bothNumeric = !isNaN(numAttr) && !isNaN(numComp);

  if (bothNumeric) {
    // Numeric comparison for all operators
    switch (operator) {
      case '<': return numAttr < numComp;
      case '<=': return numAttr <= numComp;
      case '>': return numAttr > numComp;
      case '>=': return numAttr >= numComp;
      case '==': return numAttr === numComp;
      case '!=': return numAttr !== numComp;
      default: return false;
    }
  }

  // Text comparison (one or both values are non-numeric)
  const strAttr = String(attrValue).toLowerCase();
  const strComp = String(compareValue).toLowerCase();

  switch (operator) {
    case '==': return strAttr === strComp;
    case '!=': return strAttr !== strComp;
    // Numeric operators don't apply to text
    case '<': case '<=': case '>': case '>=':
      return false;
    default: return false;
  }
}

/**
 * Human-readable labels for each comparator, used in UI dropdowns.
 */
export const COMPARATOR_LABELS: Record<AttributeComparator, string> = {
  '<': '< (menor que)',
  '<=': '<= (menor o igual)',
  '>': '> (mayor que)',
  '>=': '>= (mayor o igual)',
  '==': '== (igual a)',
  '!=': '!= (distinto de)',
  'contains': 'contiene',
  'not_contains': 'no contiene',
};

/**
 * Operators valid for numeric attributes.
 */
export const NUMERIC_COMPARATORS: AttributeComparator[] = ['==', '!=', '<', '<=', '>', '>='];

/**
 * Operators valid for text/keyword attributes.
 */
export const TEXT_COMPARATORS: AttributeComparator[] = ['==', '!=', 'contains', 'not_contains'];
