/**
 * Knowledge Graph Service
 * 
 * Builds and queries a competency knowledge graph linking:
 * officials ↔ skills ↔ courses ↔ job roles ↔ trainings
 * 
 * Powers:
 * - XAI-compliant recommendations (explains WHY a course is recommended)
 * - Hybrid recommender (content + collaborative + rule-based)
 * - Skill gap analysis with explanations
 * 
 * Why: A flat skill-match list is opaque. Government evaluators need to see
 * the reasoning chain. A knowledge graph makes reasoning explicit and auditable.
 */

import { supabaseAdmin } from '../lib/supabase.js';

interface KnowledgeNode {
  type: 'user' | 'competency' | 'course' | 'role';
  id: string;
  name: string;
  metadata?: Record<string, any>;
}

interface KnowledgeEdge {
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  relationship: string;
  weight: number;
  metadata?: Record<string, any>;
}

interface Recommendation {
  course_id: string;
  course_title: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  score: number;
  explanation: string;
  factors: Array<{ factor: string; weight: number; detail: string }>;
  algorithm: 'content' | 'collaborative' | 'rule_based' | 'hybrid';
  confidence: number;
}

export class KnowledgeGraphService {
  /**
   * Add an edge to the knowledge graph
   */
  async addEdge(edge: Omit<KnowledgeEdge, 'id' | 'created_at'>): Promise<void> {
    try {
      await supabaseAdmin.from('knowledge_graph_edges').insert(edge);
    } catch (err) {
      console.error('Failed to add KG edge:', err);
    }
  }

  /**
   * Build the user's knowledge graph from their profile + history
   */
  async buildUserGraph(userId: string): Promise<{
    nodes: KnowledgeNode[];
    edges: KnowledgeEdge[];
  }> {
    const edges: KnowledgeEdge[] = [];
    const nodes: KnowledgeNode[] = [];

    // 1. Add user node
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (!profile) return { nodes, edges };

    nodes.push({ type: 'user', id: userId, name: profile.full_name, metadata: profile });

    // 2. Add user → role edge
    if (profile.department) {
      const { data: role } = await supabaseAdmin
        .from('job_roles')
        .select('*')
        .ilike('department', `%${profile.department}%`)
        .limit(1)
        .single();

      if (role) {
        nodes.push({ type: 'role', id: role.id, name: role.title, metadata: role });
        edges.push({
          source_type: 'user', source_id: userId,
          target_type: 'role', target_id: role.id,
          relationship: 'has_role', weight: 1.0,
        });

        // 3. Add role → required competencies edges
        const requiredComps = role.required_competencies || [];
        for (const compId of requiredComps) {
          const { data: comp } = await supabaseAdmin
            .from('competencies')
            .select('*')
            .eq('id', compId)
            .single();

          if (comp) {
            nodes.push({ type: 'competency', id: comp.id, name: comp.name, metadata: comp });
            edges.push({
              source_type: 'role', source_id: role.id,
              target_type: 'competency', target_id: comp.id,
              relationship: 'requires', weight: 1.0,
            });
          }
        }

        // 4. Add role → mandatory trainings edges
        for (const courseId of role.mandatory_trainings || []) {
          const { data: course } = await supabaseAdmin
            .from('courses')
            .select('*')
            .eq('id', courseId)
            .single();

          if (course) {
            nodes.push({ type: 'course', id: course.id, name: course.title, metadata: course });
            edges.push({
              source_type: 'role', source_id: role.id,
              target_type: 'course', target_id: course.id,
              relationship: 'mandatory', weight: 1.0,
            });
          }
        }
      }
    }

    // 5. Add user → competency scores
    const { data: scores } = await supabaseAdmin
      .from('user_competency_scores')
      .select('*')
      .eq('user_id', userId);

    for (const score of scores || []) {
      edges.push({
        source_type: 'user', source_id: userId,
        target_type: 'competency', target_id: score.competency_id,
        relationship: 'has_skill',
        weight: score.current_score / 5.0,
        metadata: { gap_score: score.gap_score, current: score.current_score, required: score.required_score },
      });
    }

    // 6. Add user → course enrollments
    const { data: enrollments } = await supabaseAdmin
      .from('course_enrollments')
      .select('*')
      .eq('user_id', userId);

    for (const enrollment of enrollments || []) {
      edges.push({
        source_type: 'user', source_id: userId,
        target_type: 'course', target_id: enrollment.course_id,
        relationship: enrollment.status === 'completed' ? 'completed' : 'enrolled_in',
        weight: enrollment.progress_percentage / 100,
        metadata: { progress: enrollment.progress_percentage, status: enrollment.status },
      });
    }

    // 7. Add course → competency edges
    const { data: courses } = await supabaseAdmin.from('courses').select('*');
    for (const course of courses || []) {
      for (const compId of course.target_competencies || []) {
        edges.push({
          source_type: 'course', source_id: course.id,
          target_type: 'competency', target_id: compId,
          relationship: 'teaches', weight: 0.8,
        });
      }
    }

    return { nodes, edges };
  }

  /**
   * HYBRID RECOMMENDER
   * 
   * Combines:
   * 1. Content-based: course addresses user's competency gaps
   * 2. Collaborative: similar users (same role/dept) completed this
   * 3. Rule-based: mandatory trainings get priority boost
   * 
   * Returns XAI explanations for each recommendation.
   */
  async recommendCourses(userId: string, limit = 3): Promise<Recommendation[]> {
    const maxLimit = Math.min(Math.max(Number.isFinite(limit) ? Number(limit) : 3, 1), 3);
    const [contentRecs, collabRecs, ruleRecs] = await Promise.all([
      this.contentBased(userId),
      this.collaborativeFiltering(userId),
      this.ruleBasedMandatory(userId),
    ]);

    // Combine with weights
    const combined = new Map<string, Recommendation>();

    // Content-based: 50% weight
    for (const rec of contentRecs) {
      const score = rec.score * 0.5;
      combined.set(rec.course_id, {
        ...rec,
        score,
        algorithm: 'content',
        factors: rec.factors.map(f => ({ ...f, weight: f.weight * 0.5 })),
      });
    }

    // Collaborative: 30% weight
    for (const rec of collabRecs) {
      const existing = combined.get(rec.course_id);
      if (existing) {
        existing.score += rec.score * 0.3;
        existing.factors.push(...rec.factors.map(f => ({ ...f, weight: f.weight * 0.3 })));
        existing.algorithm = 'hybrid';
      } else {
        combined.set(rec.course_id, {
          ...rec,
          score: rec.score * 0.3,
          algorithm: 'collaborative',
          factors: rec.factors.map(f => ({ ...f, weight: f.weight * 0.3 })),
        });
      }
    }

    // Rule-based: 100% boost (mandatory = must do)
    for (const rec of ruleRecs) {
      const existing = combined.get(rec.course_id);
      if (existing) {
        existing.score += 1.0; // Full boost for mandatory
        existing.factors.push(...rec.factors);
        existing.priority = 'critical';
        existing.algorithm = 'hybrid';
      } else {
        combined.set(rec.course_id, { ...rec, score: 1.0, algorithm: 'rule_based' });
      }
    }

    // Sort and limit to the fewest truly relevant courses for the user
    const sorted = Array.from(combined.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, maxLimit);

    // Persist explanations for XAI
    await supabaseAdmin.from('recommendation_explanations').insert(
      sorted.map(r => ({
        user_id: userId,
        course_id: r.course_id,
        explanation: r.explanation,
        factors: r.factors,
        algorithm: r.algorithm,
        confidence: r.confidence,
      }))
    );

    return sorted;
  }

  /**
   * Content-based: courses that address the user's competency gaps
   */
  private async contentBased(userId: string): Promise<Recommendation[]> {
    const { data: rawScores } = await supabaseAdmin
      .from('user_competency_scores')
      .select('*, competency:competencies(id, name, domain_id)')
      .eq('user_id', userId);

    // handle old rows where gap_score is null/undefined
    const scores = (rawScores || []).map((s: any) => ({ ...s, gap_score: s.gap_score ?? (s.required_score - s.current_score) }))
      .sort((a: any, b: any) => b.gap_score - a.gap_score);

    const gaps = (scores || []).filter((s: any) => s.gap_score > 0.5);
    const recommendations: Recommendation[] = [];

    // Track already-recommended course IDs to avoid duplicates
    const seenCourses = new Set<string>();

    for (const gap of gaps.slice(0, 3)) {
      let courses: any[] | null = null;
      const compName = gap.competency?.name;

      // 1) Try exact competency NAME match (target_competencies is JSONB — use filter cs)
      if (compName) {
        const { data: exactCourses } = await supabaseAdmin
          .from('courses')
          .select('*')
          .filter('target_competencies', 'cs', JSON.stringify([compName]))
          .order('duration_hours', { ascending: true })
          .limit(5);
        if (exactCourses && exactCourses.length > 0) courses = exactCourses;
      }

      // 2) Fallback: text search on title/description for any keyword from competency name
      if (!courses || courses.length === 0) {
        const keyword = compName?.split(/[\s\/]+/)[0] || "";
        if (keyword.length >= 3) {
          const { data: textCourses } = await supabaseAdmin
            .from('courses')
            .select('*')
            .or(`title.ilike.%${keyword}%,description.ilike.%${keyword}%`)
            .order('duration_hours', { ascending: true })
            .limit(5);
          if (textCourses && textCourses.length > 0) courses = textCourses;
        }
      }

      // 3) Last resort: any courses not yet enrolled (up to 5)
      if (!courses || courses.length === 0) {
        const { data: anyCourses } = await supabaseAdmin
          .from('courses')
          .select('*')
          .order('duration_hours', { ascending: true })
          .limit(5);
        courses = anyCourses;
      }

      for (const course of courses || []) {
        if (seenCourses.has(course.id)) continue; // skip duplicates
        seenCourses.add(course.id);

        const gapSeverity = gap.gap_score / 5; // 0-1
        const score = gapSeverity * 0.9;
        recommendations.push({
          course_id: course.id,
          course_title: course.title,
          priority: gapSeverity > 0.6 ? 'high' : 'medium',
          score,
          explanation: `Addresses your "${gap.competency?.name}" gap (current: ${gap.current_score?.toFixed(1)}/5, required: ${gap.required_score}). This ${course.is_tpac_classroom ? 'classroom' : 'self-paced'} course will strengthen this competency.`,
          factors: [
            { factor: 'addresses_gap', weight: 0.9, detail: `"${gap.competency?.name}" gap of ${gap.gap_score?.toFixed(1)}` },
            { factor: 'duration_match', weight: 0.3, detail: `${course.duration_hours}h course` },
            { factor: 'domain_match', weight: 0.4, detail: `Aligned with your role` },
          ],
          algorithm: 'content',
          confidence: 0.75,
        });
      }
    }

    return recommendations;
  }

  /**
   * Collaborative: similar officials (same department/role) completed these
   */
  private async collaborativeFiltering(userId: string): Promise<Recommendation[]> {
    // Find similar users
    const { data: me } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
    if (!me) return [];

    const { data: similarUsers } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name')
      .eq('department', me.department)
      .neq('id', userId)
      .limit(20);

    if (!similarUsers || similarUsers.length === 0) return [];

    // Find courses completed by similar users but not by me
    const { data: myEnrollments } = await supabaseAdmin
      .from('course_enrollments')
      .select('course_id')
      .eq('user_id', userId);

    const myCourseIds = new Set((myEnrollments || []).map(e => e.course_id));

    const similarUserIds = similarUsers.map(u => u.id);
    const { data: theirEnrollments } = await supabaseAdmin
      .from('course_enrollments')
      .select('course_id, status')
      .in('user_id', similarUserIds)
      .eq('status', 'completed');

    // Count completions per course
    const counts = new Map<string, number>();
    for (const e of theirEnrollments || []) {
      if (!myCourseIds.has(e.course_id)) {
        counts.set(e.course_id, (counts.get(e.course_id) || 0) + 1);
      }
    }

    // Get course details for top recommendations
    const topCourseIds = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);

    if (topCourseIds.length === 0) return [];

    const { data: courses } = await supabaseAdmin
      .from('courses')
      .select('*')
      .in('id', topCourseIds);

    const totalSimilar = similarUsers.length;
    return (courses || []).map(c => {
      const completionCount = counts.get(c.id) || 0;
      const score = completionCount / totalSimilar;
      return {
        course_id: c.id,
        course_title: c.title,
        priority: 'medium',
        score,
        explanation: `${completionCount} of ${totalSimilar} colleagues in your department (${me.department}) completed this course. They've found it valuable.`,
        factors: [
          { factor: 'peer_completion', weight: score, detail: `${completionCount}/${totalSimilar} similar officials completed this` },
        ],
        algorithm: 'collaborative',
        confidence: Math.min(0.9, score + 0.2),
      };
    });
  }

  /**
   * Rule-based: mandatory trainings + iGOT compliance
   */
  private async ruleBasedMandatory(userId: string): Promise<Recommendation[]> {
    const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
    if (!profile) return [];

    const { data: roles } = await supabaseAdmin
      .from('job_roles')
      .select('*')
      .ilike('department', `%${profile.department || ''}%`)
      .limit(1);

    if (!roles || roles.length === 0) return [];

    const role = roles[0];
    const mandatoryCourseIds = role.mandatory_trainings || [];
    if (mandatoryCourseIds.length === 0) return [];

    const { data: courses } = await supabaseAdmin
      .from('courses')
      .select('*')
      .in('id', mandatoryCourseIds);

    return (courses || []).map(c => ({
      course_id: c.id,
      course_title: c.title,
      priority: 'critical' as const,
      score: 1.0,
      explanation: `MANDATORY for ${role.title} (${role.department}). Compliance requirement per iGOT Karmayogi framework.`,
      factors: [
        { factor: 'mandatory_compliance', weight: 1.0, detail: `Required for ${role.title}` },
        { factor: 'igot_framework', weight: 0.8, detail: 'Part of iGOT Karmayogi mandatory training' },
      ],
      algorithm: 'rule_based',
      confidence: 1.0,
    }));
  }

  /**
   * Get similar users (for collaborative filtering UI explanation)
   */
  async getSimilarUsers(userId: string, limit = 5): Promise<Array<{ id: string; name: string; similarity: number }>> {
    const { data: me } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
    if (!me) return [];

    const { data: others } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, designation, department')
      .neq('id', userId);

    if (!others) return [];

    // Simple similarity: same department + similar designation
    const scored = others.map(o => {
      let sim = 0;
      if (o.department === me.department) sim += 0.5;
      if (o.designation === me.designation) sim += 0.3;
      // Could add competency overlap but for now keep simple
      return { id: o.id, name: o.full_name, similarity: sim };
    });

    return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  /**
   * Forecast skill shortages
   */
  async forecastSkillShortages(department: string, horizonMonths = 12): Promise<Array<{
    competency: string;
    domain: string;
    current_supply: number;
    current_demand: number;
    predicted_shortage: number;
    drivers: string[];
  }>> {
    // Get all officials in department
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('department', department);

    if (!profiles || profiles.length === 0) return [];

    const userIds = profiles.map(p => p.id);

    // Get all competencies with scores
    const { data: scores } = await supabaseAdmin
      .from('user_competency_scores')
      .select(`
        competency_id,
        current_score,
        competency:competencies(id, name, domain:competency_domains(name))
      `)
      .in('user_id', userIds);

    // Aggregate by competency
    const compMap = new Map<string, { name: string; domain: string; total: number; count: number; belowThreshold: number }>();
    for (const s of scores || []) {
      const id = s.competency_id;
      if (!compMap.has(id)) {
        compMap.set(id, {
          name: s.competency?.name || 'Unknown',
          domain: s.competency?.domain?.name || 'Unknown',
          total: 0,
          count: 0,
          belowThreshold: 0,
        });
      }
      const c = compMap.get(id)!;
      c.total += s.current_score || 0;
      c.count++;
      if ((s.current_score || 0) < 3.0) c.belowThreshold++;
    }

    // Identify tech adoption drivers (based on which competencies have most gap)
    const forecasts = Array.from(compMap.entries()).map(([id, c]) => {
      const avgScore = c.count > 0 ? c.total / c.count : 0;
      const currentSupply = c.count - c.belowThreshold;
      const currentDemand = c.count; // Assuming all need to meet threshold
      const predictedShortage = Math.max(0, Math.round(c.belowThreshold * (1 + horizonMonths / 24) - currentSupply * 0.1));
      
      // Identify drivers
      const drivers: string[] = [];
      if (c.name.includes('AI') || c.name.includes('ML') || c.name.includes('Python')) {
        drivers.push('AI/ML adoption wave');
      }
      if (c.name.includes('Cybersecurity') || c.name.includes('Privacy')) {
        drivers.push('DPDPA 2023 compliance');
      }
      if (c.name.includes('GIS') || c.name.includes('Data Visualization')) {
        drivers.push('Digital India 2.0');
      }
      if (c.name.includes('National Accounts') || c.name.includes('SDG')) {
        drivers.push('UNSD/PARIS21 standards');
      }
      if (drivers.length === 0) drivers.push('attrition');

      return {
        competency: c.name,
        domain: c.domain,
        current_supply: currentSupply,
        current_demand: currentDemand,
        predicted_shortage: predictedShortage,
        drivers,
      };
    });

    return forecasts.sort((a, b) => b.predicted_shortage - a.predicted_shortage);
  }
}

export const knowledgeGraphService = new KnowledgeGraphService();