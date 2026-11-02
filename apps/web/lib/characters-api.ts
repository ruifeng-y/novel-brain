import type {
  CharacterKnowledgeInput,
  CharacterProfileInput,
  CharacterStateSaveInput,
} from '@novel/contracts';
import type { Entity, Relation } from './entities-api';
import { apiRequest } from './auth-api';

export type SavedCharacterProfile = CharacterProfileInput & {
  updatedAt: string | null;
};

export type CharacterProfile = SavedCharacterProfile & {
  relationships: Relation[];
};

export type CharacterKnowledge = CharacterKnowledgeInput & {
  id: string;
};

export type CharacterState = {
  body: string;
  power: string;
  location: string;
  possessions: string;
  disguise: string;
  knowledge: CharacterKnowledge[];
  version: number;
  updatedAt: string | null;
};

export type CharacterStateHistory = {
  id: string;
  version: number;
  reason: string;
  source: string;
  changedFields: string[];
  beforeState: Omit<CharacterState, 'version' | 'updatedAt'> | null;
  afterState: Omit<CharacterState, 'version' | 'updatedAt'>;
  createdAt: string;
};

export type CharacterDetail = {
  character: Entity;
  profile: CharacterProfile;
  state: CharacterState;
  history: CharacterStateHistory[];
};

function characterPath(workId: string, branchId: string, characterId: string): string {
  return `/api/v1/works/${encodeURIComponent(workId)}/branches/${encodeURIComponent(branchId)}/characters/${encodeURIComponent(characterId)}`;
}

export function loadCharacter(
  workId: string,
  branchId: string,
  characterId: string,
): Promise<CharacterDetail> {
  return apiRequest<CharacterDetail>(characterPath(workId, branchId, characterId));
}

export function saveCharacterProfile(
  workId: string,
  branchId: string,
  characterId: string,
  input: CharacterProfileInput,
): Promise<SavedCharacterProfile> {
  return apiRequest<SavedCharacterProfile>(
    `${characterPath(workId, branchId, characterId)}/profile`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

export function saveCharacterState(
  workId: string,
  branchId: string,
  characterId: string,
  input: CharacterStateSaveInput,
): Promise<CharacterDetail> {
  return apiRequest<CharacterDetail>(`${characterPath(workId, branchId, characterId)}/state`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}
