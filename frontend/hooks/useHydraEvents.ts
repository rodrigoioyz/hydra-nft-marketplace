// Real-time Hydra event hook via Server-Sent Events (CAR-10)
// Connects to GET /api/events and dispatches events to subscribers.

"use client";

import { useEffect, useRef, useCallback } from "react";

export type HydraEventType =
  | "HeadIsOpen"
  | "HeadIsClosed"
  | "HeadIsFinalized"
  | "HeadIsInitializing"
  | "HeadIsContested"
  | "ReadyToFanout"
  | "TxValid"
  | "TxInvalid"
  | "SnapshotConfirmed"
  | "Committed"
  | "Greetings"
  | "hydra:connected"
  | "hydra:disconnected"
  | "hydra:status";

export interface HydraEventMessage {
  type: HydraEventType;
  payload?: unknown;
  headStatus?: string;
  connected?: boolean;
  ts: number;
}

export type HydraEventHandler = (msg: HydraEventMessage) => void;

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Subscribe to live Hydra node events via SSE.
 *
 * @param onEvent   Called for every event received from the stream.
 * @param filter    Optional set of event types to receive (all if omitted).
 */
export function useHydraEvents(
  onEvent: HydraEventHandler,
  filter?: Set<HydraEventType>
): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  const filterRef = useRef(filter);
  filterRef.current = filter;

  const onEventStable = useCallback((msg: HydraEventMessage) => {
    if (!filterRef.current || filterRef.current.has(msg.type)) {
      handlerRef.current(msg);
    }
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1_000;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      es = new EventSource(`${API_BASE}/api/events`);

      es.onmessage = (event) => {
        try {
          const msg: HydraEventMessage = JSON.parse(event.data);
          onEventStable(msg);
        } catch {
          // ignore malformed frames
        }
      };

      es.onerror = () => {
        es?.close();
        if (!destroyed) {
          retryTimeout = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 2, 30_000);
            connect();
          }, retryDelay);
        }
      };

      es.onopen = () => {
        retryDelay = 1_000; // reset backoff on successful connect
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      es?.close();
    };
  }, [onEventStable]);
}
