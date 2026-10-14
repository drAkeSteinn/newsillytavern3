/**
 * Unit-style verification for {{estado}} key + custom relationship stage labels.
 * Run: bun scripts/verify-estado-relaciones.ts
 */
import { computeRelationshipStage, relationshipStageLabel, RELATIONSHIP_STAGES } from '../src/lib/relationships';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}`, extra ?? ''); }
}

// ── Relationship stage labels ──
const def = computeRelationshipStage(20);
check('etapa por defecto (20 pts) = Conocidos', def.label === 'Conocidos');

const custom = { extranos: 'Desconocidos', conocidos: 'Colegas', amigos: 'Compis', intimos: 'Cercanos', pareja: 'Novios' };
const c1 = computeRelationshipStage(10, custom);
check('etapa custom 0-15 = Desconocidos', c1.label === 'Desconocidos', c1);
const c2 = computeRelationshipStage(50, custom);
check('etapa custom 36-60 = Compis', c2.label === 'Compis', c2);
const c3 = computeRelationshipStage(90, { pareja: 'Novios' });
check('solo pareja custom, resto por defecto', c3.label === 'Novios' && computeRelationshipStage(10, { pareja: 'Novios' }).label === 'Extraños');
check('label vacío cae al default', relationshipStageLabel(RELATIONSHIP_STAGES[0], { extranos: '  ' }) === 'Extraños');
check('rangos intactos', RELATIONSHIP_STAGES[4].min === 86 && RELATIONSHIP_STAGES[4].max === 100);

// ── {{estado}} resolution (regex behavior parity with key-resolver) ──
const emotionalState = 'feliz';
let text = 'Estado emocional: {{estado}} / {{ESTADO}} / {estado}';
text = text.replace(/\{\{estado\}\}/gi, emotionalState || '');
text = text.replace(/\{estado\}/g, emotionalState || '');
check('{{estado}} doble se resuelve', text.includes('Estado emocional: feliz / feliz / feliz'), text);

let off = 'x {{estado}} y';
off = off.replace(/\{\{estado\}\}/gi, '').replace(/\{estado\}/g, '');
check('sin estado resuelve vacío', off === 'x  y', JSON.stringify(off));

let noDoubleBreak = '{{otros}} {estado}';
noDoubleBreak = noDoubleBreak.replace(/\{\{estado\}\}/gi, 'feliz').replace(/\{estado\}/g, 'feliz');
check('otros macros intactos', noDoubleBreak === '{{otros}} feliz', noDoubleBreak);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
