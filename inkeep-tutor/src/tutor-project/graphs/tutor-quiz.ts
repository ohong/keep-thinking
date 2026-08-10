import { agent, agentGraph } from '@inkeep/agents-sdk';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const loadTutorPrompt = () => {
	const currentDir = path.dirname(fileURLToPath(import.meta.url));
	const candidatePaths = [
		path.resolve(currentDir, '../../..', 'tutor-prompt.md'),
		path.resolve(currentDir, '../../../..', 'tutor-prompt.md'),
	];

	for (const candidate of candidatePaths) {
		if (existsSync(candidate)) {
			return readFileSync(candidate, 'utf-8').trim();
		}
	}

	throw new Error('tutor-prompt.md not found');
};

const basePrompt = loadTutorPrompt();

const tutorAgent = agent({
	id: 'tutor-quiz-agent',
	name: 'Tutor Quiz Generator',
	description: 'Creates 10-question multiple-choice quizzes for a requested learning topic.',
	prompt: `${basePrompt}

Instructions:
- Use the learner\'s most recent request to determine the topic or concept for the quiz.
- If no clear topic is provided, ask the learner to specify one before generating questions.
- Provide all 10 questions in a single response and avoid additional commentary beyond the quiz.
- Keep the wording student-friendly and clearly labeled.`,
});

export const tutorGraph = agentGraph({
	id: 'tutor-quiz-graph',
	name: 'Tutor Quiz Graph',
	description: 'Generates structured quizzes for the learner\'s selected topic.',
	defaultAgent: tutorAgent,
	agents: () => [tutorAgent],
});
