import { createMachine } from 'xstate';

export type PlayerFSMContext = {
  playerId: string;
};

export type PlayerFSMEvents =
  | { type: 'MOVE'; direction: 'up' | 'down' | 'left' | 'right' }
  | { type: 'MOVE_COMPLETE' }
  | { type: 'ATTACK'; targetId: string }
  | { type: 'ATTACK_COMPLETE' }
  | { type: 'IDLE' };

export type PlayerFSMState =
  | { value: 'idle'; context: PlayerFSMContext }
  | { value: 'moving'; context: PlayerFSMContext }
  | { value: 'attacking'; context: PlayerFSMContext };

export const createPlayerFSM = (playerId: string) => {
  return createMachine({
    id: `player-${playerId}`,
    initial: 'idle',
    context: {
      playerId,
    } satisfies PlayerFSMContext,
    states: {
      idle: {
        on: {
          MOVE: 'moving',
          ATTACK: 'attacking',
        },
      },
      moving: {
        on: {
          MOVE_COMPLETE: 'idle',
        },
      },
      attacking: {
        on: {
          ATTACK_COMPLETE: 'idle',
        },
      },
    },
  } as const);
};

export type PlayerFSM = ReturnType<typeof createPlayerFSM>;
