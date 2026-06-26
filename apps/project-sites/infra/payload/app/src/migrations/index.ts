import * as migration_20260626_015909_init from './20260626_015909_init';

export const migrations = [
  {
    up: migration_20260626_015909_init.up,
    down: migration_20260626_015909_init.down,
    name: '20260626_015909_init'
  },
];
