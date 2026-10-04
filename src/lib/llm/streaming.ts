// ============================================
// LLM Streaming - Unified streaming functions
// ============================================

import type { LLMConfig, ChatApiMessage } from './types';
import { 
  streamZAI, 
  streamOpenAICompatible, 
  streamAnthropic, 
  streamOllama, 
  streamTextGenerationWebUI,
  streamGrok
} from './providers';
import { buildCompletionPrompt } from './prompt-builder';

// ============================================
// Streaming Generator Factory
// ============================================

/**
 * Get the appropriate streaming generator based on provider
 */
// ============================================
// Helper Functions
// ============================================

/**
 * Build prompt for Ollama from chat messages
 */
function buildOllamaPrompt(messages: ChatApiMessage[], characterName: string): string {
  const parts: string[] = [];
  
  for (const msg of messages) {
    if (msg.role === 'system') {
      parts.push(msg.content);
      parts.push('\n---\n');
    } else if (msg.role === 'assistant') {
      // First assistant message is system prompt in our format
      if (messages.indexOf(msg) === 0) {
        parts.push(msg.content);
        parts.push('\n---\n');
      } else {
        parts.push(`${characterName}: ${msg.content}`);
      }
    } else {
      parts.push(`User: ${msg.content}`);
    }
  }
  
  parts.push(`\n${characterName}:`);
  
  return parts.join('\n');
}

/**
 * Build prompt for Text Generation WebUI from chat messages
 */
function buildCompletionPromptFromMessages(messages: ChatApiMessage[], characterName: string): string {
  const parts: string[] = [];
  
  for (const msg of messages) {
    if (msg.role === 'system') {
      parts.push(msg.content);
      parts.push('\n---\n');
    } else if (msg.role === 'assistant') {
      // First assistant message is system prompt in our format
      if (messages.indexOf(msg) === 0) {
        parts.push(msg.content);
        parts.push('\n---\n');
      } else {
        parts.push(`${characterName}: ${msg.content}`);
      }
    } else {
      parts.push(`User: ${msg.content}`);
    }
  }
  
  parts.push(`\n${characterName}:`);
  
  return parts.join('\n');
}

// ============================================
// Re-export provider functions
// ============================================

export {
  streamZAI,
  streamOpenAICompatible,
  streamAnthropic,
  streamOllama,
  streamTextGenerationWebUI,
  streamGrok
};
