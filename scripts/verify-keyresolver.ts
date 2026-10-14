/**
 * Verifies the REAL resolveTemplateVariables integration ({{estado}}, {estado} legacy,
 * and {{relacion_etapa}} with custom labels) using the actual key-resolver module.
 * Run: bun scripts/verify-keyresolver.ts
 */
import { resolveAllKeys } from '../src/lib/key-resolver';
import type { KeyResolutionContext } from '../src/lib/key-resolver';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}`, extra ?? ''); }
};

const baseContext: KeyResolutionContext = {
  user: 'drAke',
  char: 'Aitana',
  characterId: 'char-1',
  sessionStats: {
    characterStats: {
      'char-1': { attributeValues: { relacion: 42 }, lastUpdated: {} },
    },
  } as never,
};

// {{estado}} resolves from sessionStats.characterStats[charId].emotionalState
const ctxWithEmotion: KeyResolutionContext = {
  ...baseContext,
  sessionStats: {
    characterStats: {
      'char-1': { attributeValues: {}, lastUpdated: {}, emotionalState: 'nerviosa' },
    },
  } as never,
};

const out1 = resolveAllKeys('Estado: {{estado}} | {{ESTADO}}', ctxWithEmotion);
check('{{estado}} real resolver', out1 === 'Estado: nerviosa | nerviosa', out1);

const out2 = resolveAllKeys('Legacy: {estado}', ctxWithEmotion);
check('{estado} legacy real resolver', out2 === 'Legacy: nerviosa', out2);

const out3 = resolveAllKeys('Sin estado: {{estado}}', baseContext);
check('sin estado → vacío', out3 === 'Sin estado: ', JSON.stringify(out3));

// {{relacion_etapa}} with custom labels via context.character
const charWithLabels = {
  id: 'char-1',
  name: 'Aitana',
  relationshipStageLabels: { amigos: 'Colegas del bar' },
} as never;
const out4 = resolveAllKeys('Vínculo: {{relacion_etapa}} ({{relacion}})', {
  ...baseContext,
  character: charWithLabels,
});
check('{{relacion_etapa}} custom (42 pts = 36-60 amigos→Colegas del bar)', out4 === 'Vínculo: Colegas del bar (42)', out4);

const out5 = resolveAllKeys('Vínculo: {{relacion_etapa}}', {
  ...baseContext,
  character: { id: 'char-1', name: 'Aitana' } as never,
});
check('{{relacion_etapa}} sin labels = Amigos', out5 === 'Vínculo: Amigos', out5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
