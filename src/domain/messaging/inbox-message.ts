export interface InboxState {
  consumerName: string;
  messageId: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt?: Date;
}
export class InboxMessage {
  private constructor(private readonly state: InboxState) {}
  static receive(props: Omit<InboxState, 'receivedAt' | 'processedAt'>) {
    if (
      ![props.consumerName, props.messageId, props.payloadHash].every(
        (v) => typeof v === 'string' && v.trim(),
      )
    )
      throw new Error('INVALID_INBOX_MESSAGE');
    return new InboxMessage({ ...props, receivedAt: new Date() });
  }
  static rehydrate(state: InboxState) {
    return new InboxMessage({ ...state });
  }
  get messageId() {
    return this.state.messageId;
  }
  get consumerName() {
    return this.state.consumerName;
  }
  get payloadHash() {
    return this.state.payloadHash;
  }
  get receivedAt() {
    return new Date(this.state.receivedAt);
  }
  get processedAt() {
    return this.state.processedAt
      ? new Date(this.state.processedAt)
      : undefined;
  }
  isProcessed() {
    return !!this.state.processedAt;
  }
  markProcessed(at: Date) {
    if (this.isProcessed()) throw new Error('INBOX_ALREADY_PROCESSED');
    this.state.processedAt = new Date(at);
  }
}
