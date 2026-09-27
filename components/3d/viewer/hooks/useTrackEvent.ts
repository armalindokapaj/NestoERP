"use client";

export type TrackableEntity = "listing" | "project" | "ad";
export type TrackableEvent = "view" | "whatsapp_click" | "call_click" | "impression" | "click";

/**
 * Rozaris posts marketplace analytics here. NESTO has no marketplace
 * analytics, so the contact buttons keep their call sites and nothing is sent.
 */
const track: (entityType: TrackableEntity, entityId: string, eventType: TrackableEvent) => void = () => {};

export function useTrackEvent() {
  return track;
}
