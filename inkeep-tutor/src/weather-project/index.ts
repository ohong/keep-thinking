import { weatherGraph } from './graphs/weather-assistant.ts';
import { weatherIntermediateGraph } from './graphs/weather-intermediate.ts';
import { tutorGraph } from '../tutor-project/graphs/tutor-quiz.ts';
import { project } from '@inkeep/agents-sdk';

export const myProject = project({
  id: 'weather-project',
  name: 'Weather Project',
  description: 'Weather project template',
  graphs: () => [weatherGraph, weatherIntermediateGraph, tutorGraph],
  models: {
    'base': {
      'model': 'anthropic/claude-sonnet-4-20250514'
    },
    'structuredOutput': {
      'model': 'anthropic/claude-3-5-haiku-20241022'
    },
    'summarizer': {
      'model': 'anthropic/claude-3-5-haiku-20241022'
    }
  }
});