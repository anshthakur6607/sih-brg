/**
 * AI Service Client
 * 
 * Provides typed methods for communicating with the Python FastAPI AI service.
 * Handles authentication, request formatting, and error handling.
 * 
 * Why: Centralizes AI service calls with proper API key authentication.
 * All requests include X-API-Key header for security.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';

// AI Service base URL from environment
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
const AI_SERVICE_API_KEY = process.env.AI_SERVICE_API_KEY;

// Validate API key is set
if (!AI_SERVICE_API_KEY) {
  console.error('AI_SERVICE_API_KEY environment variable is not set');
  throw new Error('AI_SERVICE_API_KEY must be configured');
}

/**
 * Axios client configured with AI service authentication
 */
const aiServiceClient: AxiosInstance = axios.create({
  baseURL: AI_SERVICE_URL,
  timeout: 30000, // 30 second timeout for AI operations
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': AI_SERVICE_API_KEY,
  },
});

// Response interceptor for error handling
aiServiceClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response) {
      // AI service returned error response
      console.error('AI Service Error:', {
        status: error.response.status,
        data: error.response.data,
        url: error.config?.url,
      });
    } else if (error.request) {
      // No response received (AI service down?)
      console.error('AI Service unreachable:', error.message);
    }
    return Promise.reject(error);
  }
);

// ============================================
// Type Definitions
// ============================================

export interface CompetencyAssessmentRequest {
  user_id: string;
  designation: string;
  department: string;
  years_experience: number;
  education: string;
  current_assignment?: string;
}

export interface CompetencyAssessmentResponse {
  competencies: Array<{
    name: string;
    score: number;
    domain: string;
    reasoning: string;
  }>;
  baseline_scores: Array<{
    competency: string;
    score: number;
  }>;
  assessment_summary: string;
}

export interface QuizGenerationRequest {
  course_id?: string;
  competency_ids?: string[];
  question_count?: number;
  bloom_levels?: string[];
  difficulty?: number;
  document_text?: string;
}

export interface QuizQuestion {
  id: string;
  text: string;
  options: string[];
  correct_answer: number;
  bloom_level: string;
  difficulty: number;
  explanation: string;
}

export interface QuizGenerationResponse {
  questions: QuizQuestion[];
  metadata: {
    question_count: number;
    bloom_levels: string[];
    difficulty: number;
    source: string;
    generated_at: string;
  };
}

export interface EmbeddingRequest {
  text: string;
  metadata?: Record<string, unknown>;
}

export interface EmbeddingResponse {
  embedding: number[];
  dimension: number;
  text: string;
}

export interface RecommendationRequest {
  user_id: string;
  skill_gaps: Array<{
    competency_id: string;
    competency_name: string;
    gap_score: number;
  }>;
}

export interface RecommendationResponse {
  recommendations: Array<{
    course_id: string;
    course_title: string;
    priority: 'high' | 'medium' | 'low';
    reason: string;
    matching_gap: string;
  }>;
  priority_reasons: string[];
}

export interface SimulatorRequest {
  scenario: string;
  department?: string;
}

export interface SimulatorResponse {
  prediction: {
    current_average: number;
    predicted_average: number;
    improvement: number;
    scenario_description: string;
  };
  details: Record<string, unknown>;
}

// ============================================
// AI Service Methods
// ============================================

export const aiService = {
  /**
   * Health check - verify AI service is running
   */
  async healthCheck(): Promise<{ status: string; google_ai: string }> {
    const response = await aiServiceClient.get('/health');
    return response.data;
  },

  /**
   * Run AI-powered competency assessment
   * 
   * @param request - User profile data
   * @returns Baseline competency scores with reasoning
   */
  async assessCompetencies(
    request: CompetencyAssessmentRequest
  ): Promise<CompetencyAssessmentResponse> {
    try {
      const response = await aiServiceClient.post('/api/ai/assess', request);
      return response.data;
    } catch (error) {
      console.error('Competency assessment failed:', error);
      throw new Error('Failed to assess competencies via AI service');
    }
  },

  /**
   * Generate quiz questions from content
   * 
   * @param request - Quiz generation parameters
   * @returns Generated questions with Bloom's taxonomy tags
   */
  async generateQuiz(request: QuizGenerationRequest): Promise<QuizGenerationResponse> {
    try {
      const response = await aiServiceClient.post('/api/ai/quiz/generate', request);
      return response.data;
    } catch (error) {
      console.error('Quiz generation failed:', error);
      throw new Error('Failed to generate quiz via AI service');
    }
  },

  /**
   * Generate text embedding for vector search
   * 
   * @param request - Text to embed
   * @returns Vector embedding (768 dimensions)
   */
  async generateEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    try {
      const response = await aiServiceClient.post('/api/ai/embed', request);
      return response.data;
    } catch (error) {
      console.error('Embedding generation failed:', error);
      throw new Error('Failed to generate embedding via AI service');
    }
  },

  /**
   * Get AI-powered course recommendations
   * 
   * @param request - User skill gaps
   * @returns Prioritized course recommendations
   */
  async getRecommendations(
    request: RecommendationRequest
  ): Promise<RecommendationResponse> {
    try {
      const response = await aiServiceClient.post('/api/ai/recommend', request);
      return response.data;
    } catch (error) {
      console.error('Recommendation generation failed:', error);
      throw new Error('Failed to get recommendations via AI service');
    }
  },

  /**
   * Run What-If capability simulation (Admin only)
   * 
   * @param request - Simulation scenario
   * @returns Predicted org-wide metrics
   */
  async runSimulation(request: SimulatorRequest): Promise<SimulatorResponse> {
    try {
      const response = await aiServiceClient.post('/api/admin/simulate', request);
      return response.data;
    } catch (error) {
      console.error('Simulation failed:', error);
      throw new Error('Failed to run simulation via AI service');
    }
  },
};

export default aiService;