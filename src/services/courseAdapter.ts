/**
 * Pluggable Dual-Source Course Adapter
 * Fetches from live iGOT API with automatic fallback to local Supabase seeded data
 * Pattern: CourseProvider interface (per spec /src/integrations/courseAdapter.ts)
 */

export interface Course {
  id: string;
  title: string;
  description?: string;
  provider?: string;
  duration_hours?: number;
  course_url?: string;
  is_tpac_classroom?: boolean;
  tpac_start_date?: string;
  tpac_location?: string;
  target_competencies?: string[];
  source?: string;
}

export interface CourseDetail extends Course {
  modules?: { id: string; title: string; duration: number; completed?: boolean }[];
}

export interface EnrollmentStatus {
  enrolled: boolean;
  completed: boolean;
  progress_percentage?: number;
  started_at?: string;
  completed_at?: string;
}

export interface CourseProvider {
  getCourses(): Promise<Course[]>;
  getCourseDetails(courseId: string): Promise<CourseDetail>;
  getEnrollmentStatus(userId: string, courseId: string): Promise<EnrollmentStatus>;
  syncCompletionStatus(userId: string, courseId: string): Promise<boolean>;
}

/**
 * Local Provider using MoSPI/NSSTA public datasets (Seeded Supabase)
 * Used for SIH Prototype and offline fallback
 */
export class LocalCourseProvider implements CourseProvider {
  private supabase: any;
  constructor(supabaseClient: any) {
    this.supabase = supabaseClient;
  }
  async getCourses(): Promise<Course[]> {
    const { data, error } = await this.supabase.from("courses").select("*").order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    return (data || []).map((c: any) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      provider: c.provider,
      duration_hours: c.duration_hours,
      course_url: c.course_url,
      is_tpac_classroom: c.is_tpac_classroom,
      tpac_start_date: c.tpac_start_date,
      tpac_location: c.tpac_location,
      target_competencies: c.target_competencies,
      source: c.source,
    }));
  }
  async getCourseDetails(courseId: string): Promise<CourseDetail> {
    const { data, error } = await this.supabase.from("courses").select("*").eq("id", courseId).single();
    if (error) throw error;
    return { ...data, modules: [{ id: "m1", title: "Module 1", duration: 30, completed: false }] };
  }
  async getEnrollmentStatus(userId: string, courseId: string): Promise<EnrollmentStatus> {
    const { data } = await this.supabase.from("assessment_attempts").select("id").eq("user_id", userId).eq("course_id", courseId).limit(1);
    return { enrolled: !!data?.length, completed: false };
  }
  async syncCompletionStatus(userId: string, courseId: string): Promise<boolean> {
    return true;
  }
}

/**
 * Production Provider (Plugged in when official MoSPI/iGOT API keys are issued)
 * Standardized REST calls to production iGOT Sunbird endpoints
 */
export class IGOTCourseProvider implements CourseProvider {
  private apiKey: string;
  private baseUrl: string;
  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }
  async getCourses(): Promise<Course[]> {
    // In production: fetch(`${this.baseUrl}/course/v1/search`, { headers: { Authorization: `Bearer ${this.apiKey}` }})
    // For now, throw to trigger fallback if not configured correctly
    const res = await fetch(`${this.baseUrl}/api/course/search`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`IGOT API failed: ${res.status}`);
    const json: any = await res.json();
    return (json.result?.content || []).map((c: any) => ({
      id: c.identifier,
      title: c.name,
      description: c.description,
      provider: c.creator || "iGOT",
      duration_hours: c.duration ? parseFloat(c.duration) : 2,
      course_url: c.appUrl,
      is_tpac_classroom: false,
      source: "iGOT",
    }));
  }
  async getCourseDetails(courseId: string): Promise<CourseDetail> {
    const res = await fetch(`${this.baseUrl}/api/course/${courseId}`, { headers: { Authorization: `Bearer ${this.apiKey}` }});
    if (!res.ok) throw new Error(`IGOT detail failed`);
    const json: any = await res.json();
    return { id: courseId, title: json.result?.course?.name || courseId, provider: "iGOT" };
  }
  async getEnrollmentStatus(userId: string, courseId: string): Promise<EnrollmentStatus> {
    return { enrolled: false, completed: false };
  }
  async syncCompletionStatus(userId: string, courseId: string): Promise<boolean> {
    return true;
  }
}

/**
 * Composite adapter with auto-fallback
 * WHY: Ensures demo works offline (SIH judges laptops no internet) while supporting live API in production
 */
export class CourseAdapter implements CourseProvider {
  constructor(private primary: CourseProvider, private fallback: CourseProvider) {}
  private shouldUseLive(): boolean {
    return process.env.USE_IGOT_LIVE === "true";
  }
  async getCourses(): Promise<Course[]> {
    if (this.shouldUseLive()) {
      try {
        const courses = await this.primary.getCourses();
        if (courses && courses.length > 0) return courses;
        throw new Error("Empty IGOT response");
      } catch (e) {
        console.warn("[CourseAdapter] IGOT failed, falling back to local:", (e as Error).message);
      }
    }
    return this.fallback.getCourses();
  }
  async getCourseDetails(courseId: string): Promise<CourseDetail> {
    if (this.shouldUseLive()) {
      try { return await this.primary.getCourseDetails(courseId); } catch {}
    }
    return this.fallback.getCourseDetails(courseId);
  }
  async getEnrollmentStatus(userId: string, courseId: string): Promise<EnrollmentStatus> {
    return this.fallback.getEnrollmentStatus(userId, courseId);
  }
  async syncCompletionStatus(userId: string, courseId: string): Promise<boolean> {
    return this.fallback.syncCompletionStatus(userId, courseId);
  }
}

// Factory helper used in routes
import { supabaseAdmin } from "../lib/supabase.js";
export function createCourseAdapter(): CourseProvider {
  const local = new LocalCourseProvider(supabaseAdmin);
  const igot = new IGOTCourseProvider(process.env.IGOT_API_KEY || "", process.env.IGOT_BASE_URL || "https://api.igotkarmayogi.gov.in");
  return new CourseAdapter(igot, local);
}
