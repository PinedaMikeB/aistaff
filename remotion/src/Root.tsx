import React from "react";
import { Composition } from "remotion";
import { AdLostSales } from "./compositions/AdLostSales";
import { AdQuotationFlow } from "./compositions/AdQuotationFlow";
import { CloserKnowledgeExplainer } from "./compositions/CloserKnowledgeExplainer";
import { ProductTeaser } from "./compositions/ProductTeaser";
import { closerKnowledgeTotalSeconds } from "./data/closerKnowledgeExplainer";
import { DURATION_SECONDS, FPS } from "./theme";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="AdLostSales-Feed"
      component={AdLostSales}
      durationInFrames={DURATION_SECONDS * FPS}
      fps={FPS}
      width={1080}
      height={1080}
      defaultProps={{ layout: "feed" as const }}
    />
    <Composition
      id="AdLostSales-Story"
      component={AdLostSales}
      durationInFrames={DURATION_SECONDS * FPS}
      width={1080}
      height={1920}
      fps={FPS}
      defaultProps={{ layout: "story" as const }}
    />
    <Composition
      id="AdLostSales-Feed-VO"
      component={AdLostSales}
      durationInFrames={DURATION_SECONDS * FPS}
      fps={FPS}
      width={1080}
      height={1080}
      defaultProps={{ layout: "feed" as const, withVoiceover: true, voiceoverFile: "voiceovers/ad-lost-sales-feed.mp3" }}
    />
    <Composition
      id="AdLostSales-Story-VO"
      component={AdLostSales}
      durationInFrames={DURATION_SECONDS * FPS}
      width={1080}
      height={1920}
      fps={FPS}
      defaultProps={{ layout: "story" as const, withVoiceover: true, voiceoverFile: "voiceovers/ad-lost-sales-story.mp3" }}
    />
    <Composition
      id="AdQuotation-Feed"
      component={AdQuotationFlow}
      durationInFrames={DURATION_SECONDS * FPS}
      fps={FPS}
      width={1080}
      height={1080}
      defaultProps={{ layout: "feed" as const }}
    />
    <Composition
      id="AdQuotation-Story"
      component={AdQuotationFlow}
      durationInFrames={DURATION_SECONDS * FPS}
      width={1080}
      height={1920}
      fps={FPS}
      defaultProps={{ layout: "story" as const }}
    />
    <Composition
      id="CloserKnowledgeExplainer"
      component={CloserKnowledgeExplainer}
      durationInFrames={Math.ceil(closerKnowledgeTotalSeconds * FPS)}
      width={1920}
      height={1080}
      fps={FPS}
      defaultProps={{ layout: "landscape" as const, withVoiceover: true }}
    />
    <Composition
      id="CloserKnowledgeExplainer-Story"
      component={CloserKnowledgeExplainer}
      durationInFrames={Math.ceil(closerKnowledgeTotalSeconds * FPS)}
      width={1080}
      height={1920}
      fps={FPS}
      defaultProps={{ layout: "story" as const, withVoiceover: true }}
    />
    {/* Brandee product-ad MVP — parameterized teaser rendered dynamically
        via `remotion render ProductTeaser --props='{...}'` (see
        src/brandee/videoTeaserRenderer.js). Duration is derived from the
        submitted `durationInSeconds` prop (3s for the free preview, longer
        for the paid full video) via calculateMetadata rather than a fixed
        value, since the same composition serves both cases. */}
    <Composition
      id="ProductTeaser"
      component={ProductTeaser}
      durationInFrames={3 * FPS}
      width={1080}
      height={1350}
      fps={FPS}
      defaultProps={{
        styleId: "product_showcase",
        hookText: "",
        headline: "",
        ctaText: "Learn more",
        productImagePath: "",
        brandColor: "#0f172a",
        watermark: true,
        durationInSeconds: 3
      }}
      calculateMetadata={async ({ props }) => ({
        durationInFrames: Math.max(1, Math.round((props.durationInSeconds || 3) * FPS))
      })}
    />
  </>
);
