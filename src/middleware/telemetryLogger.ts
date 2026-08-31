/**
 * Telemetry Logger Middleware + Route
 * Logs anti-cheat events: tab switches, fullscreen exits, copy/paste
 * Stores in assessment_attempts.telemetry_flags and optional exam_telemetry table
 */
import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../lib/supabase.js";

export interface TelemetryEvent {
  type: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * POST /api/telemetry/log
 * Body: { assessment_id, events: TelemetryEvent[] }
 */
export async function telemetryLogHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { assessment_id, events } = req.body as { assessment_id: string; events: TelemetryEvent[] };
    if (!assessment_id || !Array.isArray(events)) {
      res.status(400).json({ success: false, error: "assessment_id and events[] required" });
      return;
    }
    // Fetch existing attempt
    const { data: attempt } = await supabaseAdmin.from("assessment_attempts").select("telemetry_flags, tab_switch_count, fullscreen_exits").eq("id", assessment_id).single();
    if (!attempt) {
      res.status(404).json({ success: false, error: "Assessment attempt not found" });
      return;
    }
    const flags: string[] = Array.isArray(attempt.telemetry_flags) ? attempt.telemetry_flags : [];
    let tabSwitches = attempt.tab_switch_count || 0;
    let fullscreenExits = attempt.fullscreen_exits || 0;
    for (const ev of events) {
      flags.push(`${ev.type}@${ev.timestamp}`);
      if (ev.type === "TAB_SWITCH_AWAY" || ev.type === "BLUR_EVENT") tabSwitches++;
      if (ev.type === "FULLSCREEN_EXIT") fullscreenExits++;
    }
    // Keep last 100 flags
    const trimmed = flags.slice(-100);
    await supabaseAdmin.from("assessment_attempts").update({
      telemetry_flags: trimmed,
      tab_switch_count: tabSwitches,
      fullscreen_exits: fullscreenExits,
    }).eq("id", assessment_id);

    // Also try to insert into exam_telemetry if table exists (ignore error if not)
    try {
      const rows = events.map(ev => ({
        assessment_id,
        event_type: ev.type,
        timestamp: new Date(ev.timestamp).toISOString(),
        metadata: ev.metadata || {}
      }));
      // @ts-ignore - table may not exist in old schema
      await supabaseAdmin.from("exam_telemetry").insert(rows);
    } catch {}

    res.json({ success: true, logged: events.length, tab_switch_count: tabSwitches, fullscreen_exits: fullscreenExits });
  } catch (e) {
    next(e);
  }
}
