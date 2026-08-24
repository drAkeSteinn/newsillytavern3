// ============================================
// Tool: Manage Scene (group chats)
// ============================================
// Category: in_character
// Lets an LLM character (or the narrative) manage scene presence in GROUP chats:
//   - enter:  bring a character (or itself) INTO the scene
//   - leave:  take a character (or itself) OUT of the scene
//   - focus:  shift narrative focus to a character (no presence change, logs an event)
//   - get_info: list who is in/out of the scene
//
// Follows the same server-validate / client-execute architecture as
// manage_action: this tool only VALIDATES and returns a `sceneActivation`
// payload; the CLIENT applies the mutation (groupSlice.applySceneChange)
// when it receives the `scene_activation` SSE event, and pushes the event
// into the session event log so other characters can react.

import type { ToolDefinition, ToolContext, ToolExecutionResult } from '../types';
import type { GroupMember } from '@/types';

export const manageSceneTool: ToolDefinition = {
  id: 'manage_scene',
  name: 'manage_scene',
  label: 'Gestionar Escena',
  icon: 'DoorOpen',
  description:
    'Gestiona la escena en chats de GRUPO. Un personaje puede ENTRAR a la escena, SALIR de ella ' +
    '(por ejemplo si se va del lugar, se desmaya, o la historia lo requiere), traer o sacar a OTRO ' +
    'personaje, o cambiar el foco narrativo hacia alguien. Usa esta herramienta SIEMPRE que tu ' +
    'personaje llegue, se vaya, sea llamado, o cuando la narrativa haga que otro personaje entre o ' +
    'salga de la escena. También puedes usar focus para centrar la atención en un personaje. ' +
    'NOTA: los personajes que salen de la escena dejan de participar hasta que vuelvan a entrar.',
  category: 'in_character',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'enum',
        enum: ['enter', 'leave', 'focus', 'get_info'],
        description: 'Acción de escena: "enter" (entrar a la escena), "leave" (salir de la escena), ' +
          '"focus" (centrar la atención en un personaje), "get_info" (consultar quién está en escena)',
        required: true,
      },
      target_character: {
        type: 'string',
        description: 'Nombre o id del personaje afectado (para entrar/salir a OTRO personaje, o para focus). ' +
          'Si se omite, la acción aplica al propio personaje que habla.',
        required: false,
      },
      narrative: {
        type: 'string',
        description: 'Descripción narrativa breve del cambio de escena (ej: "Olga escucha el escándolo y entra corriendo a la sala")',
        required: false,
      },
    },
    required: ['action'],
  },
  permissionMode: 'auto',
};

/** Resolve a member by character id or name (case-insensitive, first-word alias) */
function resolveTargetMember(
  target: string | undefined,
  context: ToolContext,
): { member: GroupMember; name: string } | null {
  if (!context.groupMembers || context.groupMembers.length === 0) return null;

  const wanted = (target || '').toLowerCase().trim();
  if (!wanted) return null;

  for (const member of context.groupMembers) {
    if (member.characterId === wanted) {
      const name = context.allCharacters?.find(c => c.id === member.characterId)?.name || member.characterId;
      return { member, name };
    }
  }

  for (const member of context.groupMembers) {
    const char = context.allCharacters?.find(c => c.id === member.characterId);
    if (!char) continue;
    const fullName = char.name.toLowerCase().trim();
    const firstName = fullName.split(/\s+/)[0];
    if (fullName === wanted || firstName === wanted) {
      return { member, name: char.name };
    }
  }

  return null;
}

export async function manageSceneExecutor(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const action = String(params.action || '').toLowerCase().trim();
  const target = params.target_character ? String(params.target_character).trim() : undefined;
  const narrative = params.narrative ? String(params.narrative) : undefined;

  const fail = (msg: string, err: string): ToolExecutionResult => ({
    success: false,
    toolName: 'manage_scene',
    result: null,
    displayMessage: msg,
    error: err,
  });

  if (!action) {
    return fail('Error: Debes especificar action (enter, leave, focus o get_info).', 'Missing action');
  }

  // Group-only tool
  if (!context.groupId || !context.groupMembers || context.groupMembers.length === 0) {
    return fail(
      'ℹ️ manage_scene solo está disponible en chats de grupo. En conversaciones 1-a-1 no hay gestión de escena.',
      'Not a group chat',
    );
  }

  // ── get_info: list scene state ──
  if (action === 'get_info') {
    const present: string[] = [];
    const absent: string[] = [];
    for (const member of context.groupMembers) {
      if (member.isNarrator) continue;
      const name = context.allCharacters?.find(c => c.id === member.characterId)?.name || member.characterId;
      if (member.isPresent === false) absent.push(name);
      else present.push(name);
    }
    return {
      success: true,
      toolName: 'manage_scene',
      result: { present, absent },
      displayMessage: `🎭 En la escena: ${present.join(', ') || '(nadie)'}\nFuera de la escena: ${absent.join(', ') || '(nadie)'}`,
    };
  }

  if (action !== 'enter' && action !== 'leave' && action !== 'focus') {
    return fail(`Error: Acción desconocida "${action}". Usa enter, leave, focus o get_info.`, 'Invalid action');
  }

  // ── Resolve the affected character (self by default) ──
  let targetMember: GroupMember;
  let targetName: string;

  if (target) {
    const resolved = resolveTargetMember(target, context);
    if (!resolved) {
      const memberNames = context.groupMembers
        .filter(m => !m.isNarrator)
        .map(m => context.allCharacters?.find(c => c.id === m.characterId)?.name || m.characterId);
      return fail(
        `Error: "${target}" no es miembro de este grupo. Miembros: ${memberNames.join(', ')}.`,
        'Target not in group',
      );
    }
    targetMember = resolved.member;
    targetName = resolved.name;
  } else {
    targetMember = context.groupMembers.find(m => m.characterId === context.characterId)
      || { characterId: context.characterId, isActive: true, isPresent: true, isNarrator: false, joinOrder: 0 };
    targetName = context.characterName;
  }

  if (targetMember.isNarrator) {
    return fail('Error: el narrador no forma parte de la escena.', 'Narrator cannot change scene');
  }

  // ── focus: no presence mutation, just a narrative event ──
  if (action === 'focus') {
    const focusDesc = narrative || `La atención se centra en ${targetName}`;
    return {
      success: true,
      toolName: 'manage_scene',
      result: { focused: targetName },
      displayMessage: `🎭 Foco narrativo: ${targetName}\n${narrative || ''}`,
      sceneActivation: {
        type: 'scene_focus',
        action: 'focus',
        characterId: targetMember.characterId,
        characterName: targetName,
        byCharacterId: context.characterId,
        byCharacterName: context.characterName,
        present: targetMember.isPresent !== false,
        narrative: focusDesc,
      },
    };
  }

  // ── enter / leave: validate current state to avoid no-op changes ──
  const isPresent = targetMember.isPresent !== false;
  const wantPresent = action === 'enter';

  if (isPresent === wantPresent) {
    const state = wantPresent ? 'ya está en la escena' : 'ya está fuera de la escena';
    return {
      success: true,
      toolName: 'manage_scene',
      result: { noOp: true },
      displayMessage: `ℹ️ ${targetName} ${state}. No se requiere cambio.`,
    };
  }

  // A character cannot bring ITSELF with target != self — that's fine, e.g. calling someone.
  // Narrator exclusion already applied. The speaker may move others (story-driven) or itself.
  const changeDesc = narrative
    || (wantPresent
      ? `${targetName} entra a la escena`
      : `${targetName} sale de la escena`);

  const verb = wantPresent ? 'entró a' : 'salió de';
  return {
    success: true,
    toolName: 'manage_scene',
    result: {
      characterId: targetMember.characterId,
      characterName: targetName,
      present: wantPresent,
    },
    displayMessage: `🎭 ${targetName} ${verb} la escena.\n${narrative || ''}`.trim(),
    sceneActivation: {
      type: 'scene_change',
      action,
      characterId: targetMember.characterId,
      characterName: targetName,
      byCharacterId: context.characterId,
      byCharacterName: context.characterName,
      present: wantPresent,
      narrative: changeDesc,
    },
  };
}
