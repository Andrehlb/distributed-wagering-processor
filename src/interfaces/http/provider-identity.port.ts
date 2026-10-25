import { Injectable } from '@nestjs/common';
/** Extension point: bind to a JWT/OIDC implementation before exposing this service publicly.
 * Health remains public; the queue is an internal trusted channel.
 */
export abstract class ProviderIdentityPort {
  abstract assertProvider(
    claimedProviderId: string,
    authorization?: string,
  ): Promise<void>;
}

/** Local exercise: identity is deliberately unauthenticated; replace this binding with OIDC. */
@Injectable()
export class DevelopmentProviderIdentity extends ProviderIdentityPort {
  async assertProvider(
    _claimedProviderId: string,
    _authorization?: string,
  ): Promise<void> {}
}
