import type { DashboardEvent } from '@kya-dash/shared';

type Distributive<T> = T extends unknown ? Omit<T, 'seq' | 'at'> : never;
export type NewEvent = Distributive<DashboardEvent>;

const MAX = 1000;

/** Typed in-memory event bus with a replay ring buffer; the dashboard is a projection of this log. */
export class EventBus {
  private buffer: DashboardEvent[] = [];
  private listeners = new Set<(e: DashboardEvent) => void>();
  private seq = 0;

  emit(e: NewEvent): DashboardEvent {
    const event = { ...e, seq: ++this.seq, at: new Date().toISOString() } as DashboardEvent;
    this.buffer.push(event);
    if (this.buffer.length > MAX) this.buffer.shift();
    for (const l of this.listeners) l(event);
    return event;
  }

  history(): DashboardEvent[] {
    return [...this.buffer];
  }

  subscribe(l: (e: DashboardEvent) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
