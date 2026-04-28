import { createFileRoute } from "@tanstack/react-router";
import { Hero } from "~/components/site/hero.tsx";
import { CodeDemo } from "~/components/site/code-demo.tsx";
import { FeatureGrid } from "~/components/site/feature-grid.tsx";
import { HowItWorks } from "~/components/site/how-it-works.tsx";
import { TrustTiers } from "~/components/site/trust-tiers.tsx";
import { CtaStrip } from "~/components/site/cta-strip.tsx";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <>
      <Hero />
      <CodeDemo />
      <FeatureGrid />
      <HowItWorks />
      <TrustTiers />
      <CtaStrip />
    </>
  );
}
