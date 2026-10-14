// ============================================
// Scenario Library Slice — App-level scenario collections (ESCENARIO V3)
// ============================================
//
// Global library of ScenarioDefinition collections ("Departamento", "Bar"...)
// managed from App Config → Escenarios. Characters/groups reference them by
// id (scenarioIds). Persisted to data/scenarios.json via the standard
// persistence sync (PERSIST_KEYS in use-persistence-sync).

import type { StateCreator } from 'zustand';
import type { ScenarioDefinition } from '@/types';
import { normalizeScenarioDefinition, normalizeScenarioLibrary } from '@/lib/scenario/library';

export interface ScenarioLibrarySlice {
  scenarios: ScenarioDefinition[];

  addScenario: (scenario: ScenarioDefinition) => void;
  updateScenario: (id: string, updates: Partial<ScenarioDefinition>) => void;
  removeScenario: (id: string) => void;
  /** Replace the whole library (import / server load). Invalid entries dropped. */
  setScenarios: (scenarios: ScenarioDefinition[]) => void;
}

export const createScenarioLibrarySlice: StateCreator<
  ScenarioLibrarySlice,
  [],
  [],
  ScenarioLibrarySlice
> = (set) => ({
  scenarios: [],

  addScenario: (scenario) =>
    set((state) => ({
      scenarios: [...state.scenarios, normalizeScenarioDefinition(scenario) || scenario],
    })),

  updateScenario: (id, updates) =>
    set((state) => ({
      scenarios: state.scenarios.map(s =>
        s.id === id
          ? { ...s, ...updates, updatedAt: new Date().toISOString() }
          : s
      ),
    })),

  removeScenario: (id) =>
    set((state) => ({
      scenarios: state.scenarios.filter(s => s.id !== id),
    })),

  setScenarios: (scenarios) =>
    set({ scenarios: normalizeScenarioLibrary(scenarios) }),
});
