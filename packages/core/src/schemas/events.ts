import { z } from "zod";
import { Mode } from "./state";

/** What triggered a tutor turn (PRD §8.2). */
export const TurnEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message") }),
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("stuck") }),
  z.object({ type: z.literal("mode_switch"), mode: Mode }),
  z.object({ type: z.literal("reset") }),
]);
export type TurnEvent = z.infer<typeof TurnEventSchema>;

/** Analytics event types (`events.type`, PRD §9.1). Props carry ids only, never chat text (NFR-19). */
export const AnalyticsEventType = z.enum([
  "registered",
  "paper_opened",
  "conversation_started",
  "message_sent",
  "reply_completed",
  "reply_failed",
  "feedback",
  "export",
  "data_request",
]);
export type AnalyticsEventType = z.infer<typeof AnalyticsEventType>;
