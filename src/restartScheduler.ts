export type RestartOperation = (reason: string) => Promise<void>;

/** Coalesces restart requests while preserving a single sequential lifecycle. */
export class RestartScheduler {
  private pendingReason: string | undefined;
  private drainPromise: Promise<void> | undefined;

  public constructor(private readonly restart: RestartOperation) {}

  public request(reason: string): Promise<void> {
    this.pendingReason = reason;
    this.drainPromise ??= this.drain();
    return this.drainPromise;
  }

  private async drain(): Promise<void> {
    try {
      while (this.pendingReason !== undefined) {
        const reason = this.pendingReason;
        this.pendingReason = undefined;
        await this.restart(reason);
      }
    } finally {
      this.drainPromise = undefined;
      if (this.pendingReason !== undefined) {
        this.drainPromise = this.drain();
      }
    }
  }
}
