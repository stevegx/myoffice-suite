# Frontend tools

- Include loading, error, and applicable empty states for each tool and each asynchronous action. Use the shared components in `src/components/ui/feedback.tsx`.
- Use `useApi` for reads and `useTask` for user actions. Use the shared request and download helpers so timeouts, server errors, and failed downloads get visible feedback.
- Keep uploaded files and edits available after a failed action. Provide a way to retry or correct the input and disable duplicate submissions while an action runs.
- Keep tool views lazy-loaded through `src/tools/toolViews.ts`.
