import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BrandLogo, BodyText, FadeSlide, GradientBackground, Headline } from "../components/Brand";
import { DashboardMock } from "../components/DashboardMock";
import { MessengerMock } from "../components/MessengerMock";
import { theme } from "../theme";

type SceneProps = {
  layout: "feed" | "story";
};

export const AdQuotationFlow: React.FC<SceneProps> = ({ layout }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const hookEnd = 2.5 * fps;
  const splitEnd = 8 * fps;

  const scene =
    frame < hookEnd ? "hook" :
    frame < splitEnd ? "split" :
    "cta";

  const ctaProgress = spring({ frame: frame - splitEnd, fps, config: { damping: 200 } });
  const ctaOpacity = interpolate(ctaProgress, [0, 1], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      <GradientBackground variant="hero" />
      <AbsoluteFill style={{ padding: layout === "story" ? "72px 56px 84px" : "56px 64px", display: "flex", flexDirection: "column" }}>
        <BrandLogo height={layout === "story" ? 40 : 36} />

        {scene === "hook" ? (
          <>
            <div style={{ height: 28 }} />
            <FadeSlide delay={4}>
              <Headline size={layout === "story" ? 64 : 54} align={layout === "story" ? "center" : "left"}>
                Manual pa rin ang quotation mula sa Messenger?
              </Headline>
              <div style={{ height: 16 }} />
              <BodyText size={26} muted align={layout === "story" ? "center" : "left"}>
                AI magtatanong ng tamang details. Team ninyo ang mag-aapprove bago mag-send.
              </BodyText>
            </FadeSlide>
          </>
        ) : null}

        {scene === "split" ? (
          <>
            <div style={{ height: 18 }} />
            <Headline size={42}>From messy chat → quotation-ready lead</Headline>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: layout === "story" ? "1fr" : "1fr 1fr", gap: 22, alignItems: "center", paddingTop: 18 }}>
              <MessengerMock startFrame={hookEnd} layout={layout === "story" ? "compact" : "compact"} />
              <DashboardMock startFrame={hookEnd + 10} />
            </div>
          </>
        ) : null}

        {scene === "cta" ? (
          <AbsoluteFill style={{ padding: layout === "story" ? "72px 56px 84px" : "56px 64px", opacity: ctaOpacity }}>
            <GradientBackground variant="hero" />
            <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: layout === "story" ? "center" : "flex-start", textAlign: layout === "story" ? "center" : "left" }}>
              <BrandLogo height={48} />
              <div style={{ height: 24 }} />
              <Headline size={52} align={layout === "story" ? "center" : "left"}>
                Free inbox audit today
              </Headline>
              <div style={{ height: 14 }} />
              <BodyText size={28} align={layout === "story" ? "center" : "left"}>
                Para sa copier, CCTV, supplier, aircon, construction, at logistics Pages.
              </BodyText>
              <div style={{ height: 24 }} />
              <div
                style={{
                  display: "inline-flex",
                  minHeight: 60,
                  padding: "0 26px",
                  borderRadius: 14,
                  background: `linear-gradient(135deg, ${theme.blue}, ${theme.lavenderStrong})`,
                  color: "#fff",
                  fontFamily: "Manrope, sans-serif",
                  fontWeight: 800,
                  fontSize: 26,
                  alignItems: "center"
                }}
              >
                aistaff.click
              </div>
            </div>
          </AbsoluteFill>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
