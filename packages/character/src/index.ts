export { UxieCharacter, CHARACTER_ASPECT, type UxieCharacterProps } from "./UxieCharacter";
export { useCharacterState, DEFAULT_FLASH_MS } from "./useCharacterState";
export {
  stateForTurn,
  STATE_META,
  type StateMeta,
  type TurnPhase,
  type TurnSignal,
  type HelpKind,
} from "./states";
export { CHARACTERS, resolveColors, normalizeHex, mix, type CharacterMeta } from "./palette";
export {
  CHARACTER_IDS,
  CHARACTER_STATES,
  TEMPOS,
  isCharacterId,
  isCharacterState,
  type CharacterId,
  type CharacterState,
  type Tempo,
  type CharacterColors,
  type ResolvedColors,
} from "./types";
