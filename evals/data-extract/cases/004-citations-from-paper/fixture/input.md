# Retrieval-augmented generation: a literature review

## Introduction

Retrieval-augmented generation (RAG) extends a language model's effective
context by interleaving model generation with external lookups
(Lewis et al., 2020, "Retrieval-augmented generation for knowledge-intensive
NLP tasks"). Early systems leaned heavily on dense passage retrieval
(Karpukhin et al., 2020, "Dense passage retrieval for open-domain question
answering"), and follow-up work has explored the trade-off between recall
and re-ranking quality (Nogueira and Cho, 2019, "Passage re-ranking with
BERT"). For a broader survey of pre-RAG question answering, see
Voorhees, 1999, "The TREC-8 question answering track report".

## Method comparison

We compare seven retrievers across three benchmarks. The dense baselines
follow Karpukhin et al., 2020; we additionally include the sparse method
described in Robertson and Zaragoza, 2009, "The probabilistic relevance
framework: BM25 and beyond". Hybrid systems that combine sparse and dense
signals were popularised by Ma et al., 2021, "A replication study of dense
passage retrieval".

In passing, we note that the original cross-encoder formulation appeared
much earlier in Devlin et al., 2018, "BERT: pre-training of deep
bidirectional transformers for language understanding", though it was not
applied to retrieval until later.

## Discussion

The closest prior survey, Mialon et al., 2023, "Augmented language models:
a survey", provides a useful taxonomy. Our work also builds on
Borgeaud et al., 2022, "Improving language models by retrieving from
trillions of tokens" — the RETRO architecture in particular. For
benchmarks beyond open-domain QA, see also
Petroni et al., 2021, "KILT: a benchmark for knowledge-intensive language
tasks".

A note on terminology: throughout we use "retriever" to mean a learned
neural model and "search backend" to mean the indexed store. (Some
authors invert these — e.g. Khattab and Zaharia, 2020 — but we adopt the
convention used in the original RAG paper.)

## NOT a citation

The following are NOT citations and should not be extracted:
- "see section 3" — internal reference, not external.
- "in 2020 we ran a pilot study" — naked year, no author.
- "a 2018 IBM whitepaper claims..." — no author or title given.
- "(this paragraph) — Karpukhin et al., 2020" — repeats an already-listed
  citation; should appear only once in your output.

## Final citation

We close with a methodological note, drawing on
Bender and Koller, 2020, "Climbing towards NLU: on meaning, form, and
understanding in the age of data".
