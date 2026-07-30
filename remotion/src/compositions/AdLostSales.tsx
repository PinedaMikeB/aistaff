import React from "react";
import { AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { BrandLogo, BodyText, FadeSlide, GradientBackground, Headline } from "../components/Brand";
import { CheckItem } from "../components/DashboardMock";
import { DashboardMock } from "../components/DashboardMock";
import { MessengerMock } from "../components/MessengerMock";
import { manrope } from "../fonts";
import { theme } from "../theme";

type SceneProps = {
  layout: "feed" | "story";
  withVoiceover?: boolean;
  voiceoverFile?: string;
};

const padding = (layout: "feed" | "story") => (layout === "story" ? "72px 56px 84px" : "56px 64px");

export const AdLostSales: React.FC<SceneProps> = ({
  layout,
  withVoiceover = false,
  voiceoverFile = "voiceovers/ad-lost-sales-feed.mp3"
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const hookEnd = 2 * fps;
  const problemEnd = 6 * fps;
  const solutionEnd = 11 * fps;

  const scene =
    frame < hookEnd ? "hook" :
    frame < problemEnd ? "problem" :
    frame < solutionEnd ? "solution" :
    "cta";

  const ctaProgress = spring({
    frame: frame - solutionEnd,
    fps,
    config: { damping: 200 }
  });
  const ctaOpacity = interpolate(ctaProgress, [0, 1], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      {withVoiceover ? <Audio src={staticFile(voiceoverFile)} volume={1} /> : null}
      <GradientBackground variant="hero" />

      {scene === "cta" ? (
        <AbsoluteFill style={{ padding: padding(layout), opacity: ctaOpacity }}>
          <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: layout === "story" ? "center" : "flex-start", textAlign: layout === "story" ? "center" : "left" }}>
            <BrandLogo height={layout === "story" ? 52 : 44} />
            <div style={{ height: 28 }} />
            <Headline size={layout === "story" ? 62 : 54} align={layout === "story" ? "center" : "left"}>
              Book your free inbox audit today
            </Headline>
            <div style={{ height: 16 }} />
            <BodyText size={layout === "story" ? 32 : 28} align={layout === "story" ? "center" : "left"}>
              Makita kung saan nawawala ang leads — at paano i-fix ang inquiry flow ninyo.
            </BodyText>
            <div style={{ height: 28 }} />
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 64,
                padding: "0 28px",
                borderRadius: 14,
                background: `linear-gradient(135deg, ${theme.blue}, ${theme.lavenderStrong})`,
                color: "#fff",
                fontFamily: manrope,
                fontWeight: 800,
                fontSize: 28,
                boxShadow: "0 14px 34px rgba(94,120,216,0.35)"
              }}
            >
              aistaff.click
            </div>
          </div>
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ padding: padding(layout), display: "flex", flexDirection: "column" }}>
          <div style={{ marginBottom: layout === "story" ? 36 : 24 }}>
            <BrandLogo height={layout === "story" ? 40 : 36} />
          </div>

          {scene === "hook" ? (
            <FadeSlide delay={4}>
              <Headline size={layout === "story" ? 68 : 58} align={layout === "story" ? "center" : "left"}>
                Nawawala ang sales dahil late ang reply sa Facebook?
              </Headline>
              <div style={{ height: 18 }} />
              <BodyText size={layout === "story" ? 30 : 26} muted align={layout === "story" ? "center" : "left"}>
                Maraming B2B Page nawawalan ng hot inquiries sa Messenger.
              </BodyText>
            </FadeSlide>
          ) : null}

          {scene === "problem" ? (
            <>
              <FadeSlide delay={0}>
                <Headline size={layout === "story" ? 52 : 46}>
                  Customer nag-message… pero late ang sagot.
                </Headline>
              </FadeSlide>
              <div style={{ flex: 1, display: "grid", placeItems: "center", paddingTop: layout === "story" ? 24 : 12 }}>
                <MessengerMock startFrame={hookEnd} layout={layout === "story" ? "tall" : "compact"} />
              </div>
            </>
          ) : null}

          {scene === "solution" ? (
            <>
              <FadeSlide delay={0}>
                <Headline size={layout === "story" ? 50 : 44}>
                  AIStaff para sa Facebook Page inbox ninyo
                </Headline>
              </FadeSlide>
              <div style={{ height: 22 }} />
              <div style={{ display: "flex", flexDirection: layout === "story" ? "column" : "row", gap: 28, flex: 1, alignItems: layout === "story" ? "stretch" : "center" }}>
                <div style={{ flex: layout === "story" ? undefined : 1, display: "flex", flexDirection: "column", gap: 16 }}>
                  <CheckItem text="Sumagot agad sa Messenger" delay={problemEnd + 4} />
                  <CheckItem text="Magtanong ng qualifying details" delay={problemEnd + 10} />
                  <CheckItem text="I-save ang leads sa dashboard" delay={problemEnd + 16} />
                  <CheckItem text="Maghanda ng quotation draft bago i-approve ninyo" delay={problemEnd + 22} />
                </div>
                {layout === "feed" ? (
                  <div style={{ flex: 1.1 }}>
                    <DashboardMock startFrame={problemEnd} />
                  </div>
                ) : null}
              </div>
              {layout === "story" ? (
                <div style={{ marginTop: 18 }}>
                  <DashboardMock startFrame={problemEnd} />
                </div>
              ) : null}
            </>
          ) : null}
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
