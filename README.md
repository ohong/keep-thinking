# keep-thinking

A smart quiz application that helps you learn new things while waiting for AI to code.

## How it works

Keep-thinking automatically detects when you have active Claude Code sessions by monitoring `.claude/projects/**.jsonl` files. When it detects active sessions (based on recent messages with tool usage or specific trigger phrases), it presents you with educational quiz questions to keep your mind engaged during AI processing time.

### Key Features

- **Automatic session detection**: Monitors Claude Code session files to detect when AI is actively working
- **Interactive quiz interface**: Presents multiple-choice, true/false, and short-answer questions
- **Smart session monitoring**: Detects active sessions based on recent assistant messages with tool usage or action phrases like "Now I'll...", "Let me...", etc.
- **Real-time updates**: Shows live timer, session count, and quiz scores
- **Customizable question bank**: Load questions from markdown files in the `questions/` directory

### Session Detection Logic

The app monitors `.claude/projects/` directories and considers a session "active" when:
- A message was sent within the last 5 minutes, AND
- The message contains tool usage (indicating AI is performing actions), OR
- The message text starts with action phrases like "Now I'll", "Let me", "I need", etc.

## Usage

```bash
npm run dev
```

The app will automatically start monitoring for Claude Code sessions and present quiz questions when sessions become active.
