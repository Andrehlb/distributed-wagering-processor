import type { EntityName } from '@mikro-orm/core';
/** MikroORM mapToPk stores a string while EntitySchema's relation generic expects
 * the target to share that scalar type. Keep that typing boundary in one place. */
export function primaryKeyTarget<T>(
  target: EntityName<T>,
): () => EntityName<string> {
  return () => target as unknown as EntityName<string>;
}
