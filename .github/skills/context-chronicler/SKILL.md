---
name: context-chronicler
description: "Use when you want to analyze current game code and editing tool changes, then update .github/copilot-instructions.md with architecture decisions, editor/tool descriptions, and style guidelines."
---

# Context Chronicler

## Purpose
Analyze current changes across the game codebase and editor tooling, then update `.github/copilot-instructions.md` so future work can account for project architecture, map editor features, game editing tools, and style guidelines without asking external questions.

## Workflow
1. Review the current workspace changes and recent edits in the game code, engine, and editor tooling.
2. Identify new architectural decisions and design patterns introduced by the changes.
3. Document map editor and other game editing tools, including their responsibilities, locations, and how they are intended to be used or extended.
4. Record style guidelines, naming conventions, and any project-specific code or asset conventions found in the changes.
5. Update or create `.github/copilot-instructions.md`:
   - preserve existing instruction content when relevant
   - add new sections for architecture, tools, and style
   - keep the file concise and actionable for future agents
6. Summarize the final changes in the updated instructions file and note any remaining ambiguities or follow-up recommendations.

## Quality Criteria
- `.github/copilot-instructions.md` exists and is updated with the new context
- Architectural decisions are clearly described, not just listed
- Editor and tool capabilities are documented in a way that can guide future code and tool changes
- Style and convention notes are explicit and suitable for agent use
- Existing project instructions are respected and extended, not overwritten blindly

## Use When
Use this skill when the project has changed game architecture, editor tools, or style expectations and you want those decisions captured in the workspace instructions file for future work.
