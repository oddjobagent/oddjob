# zeta.md — JIT skill loading

Skills are agent extension blocks defined in `SKILL.md` files. Today the
default behaviour is to inject every declared skill's full body into the
system prompt at run start — convenient but expensive. Skill bodies are
typically 1-10KB each; a blueprint with 5 skills can spend 50KB of
context every turn just on instructions the agent may never need.

JIT loading: emit a manifest (one line per skill, name + 1-line
description) in the system prompt and provide a `skill_load(name)` tool
that returns the full body on demand. Skills the agent doesn't invoke
cost ~30 tokens (the manifest line) instead of their full body.

The manifest line is what the agent uses to decide IF to load. So the
1-line description must be informative — "Researcher" is useless;
"Researcher: builds a fact-graph from URLs, returning structured claims +
citations" tells the agent when to invoke it.
