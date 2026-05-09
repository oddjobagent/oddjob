# beta — retry policies for unreliable upstreams

Exponential backoff with jitter is the standard policy. Base delay 500ms,
multiplier 2x, jitter 30%, cap at 8s, three attempts. Retry only on
network and 5xx-class errors — never on 4xx (those won't change).

Circuit breakers add a fast-fail path: after N consecutive same-class
failures, short-circuit for a cooldown window before retrying.
