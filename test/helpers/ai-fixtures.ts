import type { Mock } from 'vitest';
import type { AuthUser } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import { TEST_USER_ID } from './test-auth.guard.js';

/**
 * A recipe draft that passes `recipeDraftSchema` unchanged, so the fixture
 * doubles as the exact expected response payload.
 */
export const AI_RECIPE_DRAFT = {
  title: 'Tomato Rice',
  description: 'A quick one-pot dish.',
  cuisine: 'Italian',
  prepTimeMinutes: 15,
  cookTimeMinutes: 20,
  servings: 2,
  difficulty: 'easy',
  image: null,
  ingredients: [
    { name: 'rice', amount: 200, unit: 'g' },
    { name: 'salt', amount: null, unit: '' },
  ],
  steps: [
    { instruction: 'Boil the rice.' },
    { instruction: 'Season with salt.' },
  ],
  dietaryTags: ['vegetarian'],
};

export const AI_NUTRITION_ANALYSIS = {
  caloriesPerServing: 540,
  proteinGrams: 32,
  carbsGrams: 48,
  fatGrams: 14,
  suggestions: ['Use Greek yogurt instead of cream to cut 8g fat per serving.'],
};

export const GEMINI_USAGE = {
  promptTokenCount: 100,
  candidatesTokenCount: 20,
  totalTokenCount: 120,
};

export function geminiText(text: string, usage = GEMINI_USAGE) {
  return { modelVersion: 'gemini-2.5-flash', text, usageMetadata: usage };
}

/**
 * Wires the mocked `@google/genai` module (the spec file must carry the
 * matching `vi.mock('@google/genai', …)` factory) so every strategy
 * instance shares these mocks. Call before compiling the test app.
 */
export function installGeminiMock() {
  const generateContent = vi.fn();
  const generateContentStream = vi.fn();
  // Regular function: Vitest applies `new` to the implementation directly,
  // and arrow functions are not constructible.
  (GoogleGenAI as unknown as Mock).mockImplementation(function () {
    return { models: { generateContent, generateContentStream } };
  });
  return { generateContent, generateContentStream };
}

export const PREMIUM_USER: Partial<AuthUser> = {
  id: TEST_USER_ID,
  email: 'premium@test.local',
};
