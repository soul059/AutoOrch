// Event broadcaster - exports a simple event emitter pattern to avoid circular deps
type EventCallback = (runId: string, event: Record<string, unknown>) => void;

let broadcastFn: EventCallback | null = null;

export function setBroadcastFunction(fn: EventCallback): void {
  broadcastFn = fn;
}

export function broadcast(runId: string, event: Record<string, unknown>): void {
  if (broadcastFn) {
    broadcastFn(runId, event);
  } else {
    console.warn('[Events] No broadcast function registered, event dropped:', event.type);
  }
}
