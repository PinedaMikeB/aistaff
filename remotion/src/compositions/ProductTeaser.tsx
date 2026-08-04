import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Sequence } from "remotion";

// Real, parameterized product-ad teaser composition (PART 11/12 of the
// Brandee product-ad MVP). Rendered via src/brandee/videoTeaserRenderer.js
// using the same `remotion render --props=...` pattern already used for
// the fixed marketing-ad compositions in this folder. Kept intentionally
// simple (one composition, style-driven pacing/copy rather than six fully
// separate animations) so the free 3-second preview renders quickly and
// reliably; longer/richer variants for the paid full video are a follow-up.

export type ProductTeaserProps = {
  styleId: string;
  hookText: string;
  headline: string;
  ctaText: string;
  productImagePath: string;
  brandColor: string;
  watermark: boolean;
  durationInSeconds: number;
};

const STYLE_PACING: Record<string, { openHold: number; label: string }> = {
  ugc_recommendation: { openHold: 0.6, label: "Recommended by a real customer" },
  product_demo: { openHold: 0.4, label: "See it in action" },
  problem_solution: { openHold: 0.5, label: "There's a better way" },
  offer_promo: { openHold: 0.3, label: "Limited-time offer" },
  unboxing: { openHold: 0.5, label: "First look" },
  product_showcase: { openHold: 0.4, label: "Meet the product" }
};

export const ProductTeaser: React.FC<ProductTeaserProps> = ({
  styleId,
  hookText,
  headline,
  ctaText,
  productImagePath,
  brandColor,
  watermark
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const pacing = STYLE_PACING[styleId] || STYLE_PACING.product_showcase;

  const hookOpacity = interpolate(frame, [0, fps * 0.3, fps * pacing.openHold, fps * (pacing.openHold + 0.4)], [0, 1, 1, 0], { extrapolateRight: "clamp" });
  const productScale = interpolate(frame, [0, durationInFrames], [1.04, 1.0], { extrapolateRight: "clamp" });
  const ctaOpacity = interpolate(frame, [durationInFrames - fps * 0.8, durationInFrames - fps * 0.2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: brandColor || "#0f172a" }}>
      {productImagePath ? (
        // Plain <img> with a file:// URL (not Remotion's staticFile helper,
        // since this asset is a per-request temp file outside the public
        // folder) — Remotion's headless-Chromium renderer loads local
        // file:// image sources directly.
        <AbsoluteFill style={{ transform: `scale(${productScale})` }}>
          <img
            src={`file://${productImagePath}`}
            style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.92 }}
          />
        </AbsoluteFill>
      ) : null}

      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(2,6,23,0.15) 0%, rgba(2,6,23,0.75) 100%)" }} />

      <Sequence from={0}>
        <AbsoluteFill style={{ justifyContent: "flex-end", padding: 48, opacity: hookOpacity }}>
          <div style={{ fontFamily: "Manrope, Arial, sans-serif", fontSize: 44, fontWeight: 800, color: "#fff", lineHeight: 1.15, textShadow: "0 2px 12px rgba(0,0,0,0.5)" }}>
            {hookText || headline}
          </div>
          <div style={{ fontFamily: "Manrope, Arial, sans-serif", fontSize: 20, fontWeight: 600, color: "#cbd5e1", marginTop: 12 }}>
            {pacing.label}
          </div>
        </AbsoluteFill>
      </Sequence>

      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-start", padding: 48, opacity: ctaOpacity }}>
        <div style={{
          background: "#3b82f6",
          color: "#fff",
          fontFamily: "Manrope, Arial, sans-serif",
          fontSize: 22,
          fontWeight: 700,
          padding: "12px 28px",
          borderRadius: 10
        }}>
          {ctaText || "Learn more"}
        </div>
      </AbsoluteFill>

      {watermark ? (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
          <div style={{
            fontFamily: "Manrope, Arial, sans-serif",
            fontSize: 32,
            fontWeight: 800,
            color: "rgba(255,255,255,0.18)",
            transform: "rotate(-24deg)",
            letterSpacing: 4
          }}>
            BRANDEE PREVIEW
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
