import React from "react";
import { Composition } from "remotion";
import { AdLostSales } from "./compositions/AdLostSales";
import { AdQuotationFlow } from "./compositions/AdQuotationFlow";
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
  </>
);
