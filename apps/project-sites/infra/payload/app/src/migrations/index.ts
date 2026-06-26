import * as migration_20260626_015909_init from './20260626_015909_init';
import * as migration_20260626_020836_blog from './20260626_020836_blog';

export const migrations = [
  {
    up: migration_20260626_015909_init.up,
    down: migration_20260626_015909_init.down,
    name: '20260626_015909_init',
  },
  {
    up: migration_20260626_020836_blog.up,
    down: migration_20260626_020836_blog.down,
    name: '20260626_020836_blog'
  },
];
