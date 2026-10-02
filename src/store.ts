/** Минимальное наблюдаемое состояние для объектов вне React. */
export class Store<T> {
  private listeners = new Set<(snapshot: T) => void>();
  constructor(private snapshot: T) {}

  get(): T {
    return this.snapshot;
  }

  set(patch: Partial<T>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  subscribe(listener: (snapshot: T) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }
}
