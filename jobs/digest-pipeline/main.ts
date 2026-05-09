// Demo pipeline that exercises ctx.fork end-to-end.
//
// Shape:
//
//                              digest-pipeline (this file)
//                                       |
//                  +--------------------+--------------------+
//                  |                    |                    |
//             fetcher (a)          fetcher (b)          fetcher (c)
//                  |                    |                    |
//             summarizer (a)       summarizer (b)       summarizer (c)
//                  |                    |                    |
//                  +--------------------+--------------------+
//                                       |
//                                    joiner
//
// In v1 ctx.fork is sync, so we fork the three fetcher branches one at a
// time. Each fetcher's output feeds into a summarizer. The joiner takes
// all three summaries and returns a markdown digest. Replay-safe — every
// ctx.* call is recorded in run_events; killing the process mid-run and
// resuming with the same runId picks up where it left off.

import { defineRun } from "@oddjob/sdk";

interface Inputs {
  topic: string;
  // Three "URLs" — in this demo the fetcher just returns a stub instead
  // of actually hitting the network. Real digest-pipeline would `ctx.tool
  // ("web_fetch", {url})`.
  urls: [string, string, string];
}

interface Output {
  topic: string;
  digest: string;
  partial_summaries: string[];
}

export default defineRun<Inputs, Output>(
  {
    /* schemas omitted for the demo; production blueprints would supply
       JSON-Schema or typebox-compiled shapes. */
  },
  async (ctx) => {
    const inputs = ctx.inputs;

    // Each fetcher is a child blueprint. v1 ctx.fork is sync — we await
    // each one in turn. (Async fork is YAGNI per locked decisions.)
    // The fork's return type is whatever the child blueprint emits as
    // `structuredOutput`.
    const fetchA = await ctx.fork<{ url: string }, { url: string; body: string }>(
      "./fetcher",
      { url: inputs.urls[0] },
    );
    const fetchB = await ctx.fork<{ url: string }, { url: string; body: string }>(
      "./fetcher",
      { url: inputs.urls[1] },
    );
    const fetchC = await ctx.fork<{ url: string }, { url: string; body: string }>(
      "./fetcher",
      { url: inputs.urls[2] },
    );

    // Summarize each in parallel — but ctx.fork is single-dispatch, so
    // these run sequentially. v2 (when async fork lands) will hide a
    // Promise<TOut> behind ctx.fork({wait: "async"}) and let summarize
    // calls overlap.
    const sumA = await ctx.fork<{ source: string }, { summary: string }>("./summarizer", {
      source: fetchA.body,
    });
    const sumB = await ctx.fork<{ source: string }, { summary: string }>("./summarizer", {
      source: fetchB.body,
    });
    const sumC = await ctx.fork<{ source: string }, { summary: string }>("./summarizer", {
      source: fetchC.body,
    });

    const partial_summaries = [sumA.summary, sumB.summary, sumC.summary];

    // Joiner takes the three summaries + topic, produces the final
    // digest. ctx.fork chain depth here is 2 (root → joiner). With
    // fetcher and summarizer also forked, the run tree has 7 children
    // visible in the dashboard's RunTree (B2.6).
    const joined = await ctx.fork<
      { topic: string; summaries: string[] },
      { digest: string }
    >("./joiner", {
      topic: inputs.topic,
      summaries: partial_summaries,
    });

    return {
      topic: inputs.topic,
      digest: joined.digest,
      partial_summaries,
    };
  },
);
