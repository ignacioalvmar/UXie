LEARNER STATE (private; do not recite it to the student)
Objectives:
{{#each objectives}}
- {{this.id}} ({{this.kind}}): {{this.statement}} [{{this.status}}]{{#if this.active}} <- current{{/if}}
{{/each}}
{{#if misconceptions}}
Unresolved misconceptions to address:
{{#each misconceptions}}
- {{this.objective}}: "{{this.text}}"
{{/each}}
{{/if}}
{{#if history_summary}}
Summary of the earlier dialogue: {{history_summary}}
{{/if}}
