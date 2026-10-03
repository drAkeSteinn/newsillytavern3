// Test: collectThresholdMessages edge-triggering + tag resolution
import { collectThresholdMessages, resolveThresholdMessageText } from '@/lib/stats/threshold-messages';
import type { SessionStats, CharacterStatsConfig } from '@/types';

const statsConfig: CharacterStatsConfig = {
  enabled: true,
  timerEnabled: false,
  attributes: [
    {
      id: 'a1',
      name: 'Fuerza',
      key: 'fuerza',
      type: 'number',
      defaultValue: 10,
      min: 0,
      max: 100,
      thresholdEffects: [
        {
          id: 'eff-50',
          name: 'Fuerza 50',
          enabled: true,
          priority: 0,
          conditions: [{ attributeKey: 'fuerza', operator: '>=', value: 50 }],
          conditionOperator: 'AND',
          rewards: [
            { id: 'r1', type: 'message', message: { text: '{{char}} tiene ahora {{fuerza}} de fuerza ({{user}} lo confirma)' } },
            { id: 'r2', type: 'attribute', attribute: { key: 'fuerza', value: 60, action: 'set' } },
          ],
        } as any,
      ],
    },
  ],
} as any;

function makeSessionStats(fuerza: number, prevStates: Record<string, boolean> = {}): SessionStats {
  return {
    characterStats: {
      'char-x': {
        attributeValues: { fuerza, relacion: 42 },
        lastUpdated: {},
        changeLog: [],
      },
      __user__: {
        attributeValues: { oro: 999 },
        lastUpdated: {},
        changeLog: [],
      },
    },
    solicitudes: { characterSolicitudes: {}, lastModified: Date.now() },
    initialized: true,
    lastModified: Date.now(),
    thresholdMessageStates: prevStates,
  } as any;
}

const target = { characterId: 'char-x', characterName: 'Ximena', statsConfig };

// SCAN 1: crosses 50 (no prev state) → SHOULD fire
const s1 = makeSessionStats(50);
const r1 = collectThresholdMessages({ sessionStats: s1, targets: [target], userName: 'Ana' });
console.log('SCAN1 fired:', r1.messages.length === 1, '| text:', JSON.stringify(r1.messages[0]?.text), '| state:', r1.newStates['char-x:fuerza:eff-50']);

// SCAN 2: still >= 50 (state true) → SHOULD NOT fire
const s2 = makeSessionStats(55, { 'char-x:fuerza:eff-50': true });
const r2 = collectThresholdMessages({ sessionStats: s2, targets: [target], userName: 'Ana' });
console.log('SCAN2 fired:', r2.messages.length, '(expect 0)', '| state:', r2.newStates['char-x:fuerza:eff-50']);

// SCAN 3: drops below 50 → edge resets to false, no fire
const s3 = makeSessionStats(30, { 'char-x:fuerza:eff-50': true });
const r3 = collectThresholdMessages({ sessionStats: s3, targets: [target], userName: 'Ana' });
console.log('SCAN3 fired:', r3.messages.length, '(expect 0)', '| state reset:', r3.newStates['char-x:fuerza:eff-50'] === false);

// SCAN 4: crosses again → fires once more
const s4 = makeSessionStats(70, { 'char-x:fuerza:eff-50': false });
const r4 = collectThresholdMessages({ sessionStats: s4, targets: [target], userName: 'Ana' });
console.log('SCAN4 fired:', r4.messages.length === 1, '(expect 1)');

// SCAN 5: persona fallback attrs + {{relacion}} + disabled effect
const statsConfigDisabled = { ...statsConfig, attributes: [{ ...statsConfig.attributes[0], thresholdEffects: [{ ...statsConfig.attributes[0].thresholdEffects[0], enabled: false }] }] } as any;
const r5 = collectThresholdMessages({
  sessionStats: makeSessionStats(50),
  targets: [{ characterId: 'char-x', characterName: 'Ximena', statsConfig: statsConfigDisabled }],
  userName: 'Ana',
});
console.log('SCAN5 (disabled effect) fired:', r5.messages.length, '(expect 0)');

// Tag resolution: {{oro}} from persona fallback, {{relacion}}, {{time}}
const txt = resolveThresholdMessageText('{{char}} tiene {{oro}} de oro, relacion {{relacion}}, ahora {{time}}', target, makeSessionStats(50), 'Ana');
console.log('TAGS resolved:', JSON.stringify(txt));

// Empty text message → not fired
const cfgEmpty = {
  ...statsConfig,
  attributes: [{
    ...statsConfig.attributes[0],
    thresholdEffects: [{
      ...statsConfig.attributes[0].thresholdEffects[0],
      rewards: [{ id: 'r9', type: 'message', message: { text: '   ' } }],
    }],
  }],
} as any;
const r6 = collectThresholdMessages({ sessionStats: makeSessionStats(50), targets: [{ characterId: 'char-x', characterName: 'Ximena', statsConfig: cfgEmpty }], userName: 'Ana' });
console.log('EMPTY text fired:', r6.messages.length, '(expect 0)');
