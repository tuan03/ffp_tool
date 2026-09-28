/** Owns keyword cleanup until preparation successfully hands the product to review. */
export class SeoCorpusReservation {
  private retained = false;
  private disposed = false;

  constructor(private readonly release: () => Promise<void>) {}

  retain(): void {
    this.retained = true;
  }

  async dispose(): Promise<void> {
    if (this.retained || this.disposed) return;
    await this.release();
    this.disposed = true;
  }
}
