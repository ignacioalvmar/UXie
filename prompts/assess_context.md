LEARNER STATE
Mode: {{mode}}.{{#if active_objective}} Current objective: {{active_objective}}.{{/if}}
Objective statuses:
{{#each objectives}}
- {{this.id}}: {{this.status}}
{{/each}}
{{#if misconceptions}}
Previously recorded misconceptions:
{{#each misconceptions}}
- "{{this.text}}" ({{this.objective}}{{#if this.resolved}}, resolved{{/if}})
{{/each}}
{{/if}}

TUTOR'S LAST MESSAGE:
<tutor_message>
{{tutor_message}}
</tutor_message>

The student's message follows as the user turn. Assess only that message.
