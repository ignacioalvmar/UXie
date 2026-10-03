# UXie load test: anthropic:claude-sonnet-5-5@low+anthropic:claude-haiku-4-5

2026-10-03T19:56:56.904Z · fixture visible-cues · scripted students send messages back to back (no reading pauses), so this is a worst case for the given number of concurrent students.

| Concurrency | Turns | Turns/student | TTFT p50 | TTFT p95 (≤ 10 s; target ≤ 4 s) | Latency p95 | Error rate | Errors | Cost   |
| ----------- | ----- | ------------- | -------- | ------------------------------- | ----------- | ---------- | ------ | ------ |
| 5           | 51    | 10.2          | 2.7 s    | 3.9 s                           | 6.1 s       | 0.0%       | –      | €0.542 |
| 10          | 101   | 10.1          | 2.8 s    | 3.8 s                           | 5.9 s       | 0.0%       | –      | €0.990 |
| 15          | 151   | 10.1          | 2.4 s    | 4.0 s                           | 6.2 s       | 0.0%       | –      | €1.536 |

Cost covers every model call of the tutor (replies, assessments, history summaries).
