"use strict";

/**
 * Minimal SDP handling for G.711 audio only.
 *
 * We deliberately offer/answer PCMU and PCMA and nothing else. The AIO100
 * supports G.729 and G.723 too, but those are patent-encumbered, need a
 * transcode step, and buy nothing on a LAN. G.711 is what the cellular side
 * transcodes to anyway.
 */

/** Parse a remote SDP into { host, port, codec }. */
function parseSdp(sdp) {
  const lines = String(sdp).split(/\r?\n/);
  let host = null;
  let port = null;
  const payloadTypes = [];
  const rtpmap = {};

  for (const line of lines) {
    if (line.startsWith("c=IN IP4 ")) {
      host = line.slice("c=IN IP4 ".length).trim();
    } else if (line.startsWith("m=audio ")) {
      const parts = line.split(/\s+/);
      port = Number.parseInt(parts[1], 10);
      for (let i = 3; i < parts.length; i++) {
        const pt = Number.parseInt(parts[i], 10);
        if (Number.isFinite(pt)) payloadTypes.push(pt);
      }
    } else if (line.startsWith("a=rtpmap:")) {
      const m = line.match(/^a=rtpmap:(\d+)\s+([A-Za-z0-9._-]+)\//);
      if (m) rtpmap[Number.parseInt(m[1], 10)] = m[2].toUpperCase();
    }
  }

  // Prefer PCMU, then PCMA — first one the far end actually offered.
  let codec = null;
  for (const pt of payloadTypes) {
    const name = rtpmap[pt] || (pt === 0 ? "PCMU" : pt === 8 ? "PCMA" : null);
    if (name === "PCMU" || name === "PCMA") { codec = name; break; }
  }

  return { host, port, codec };
}

/** Build our SDP answer. */
function buildSdp({ localHost, localPort, codec = "PCMU", sessionId }) {
  const id = sessionId || Math.floor(Date.now() / 1000);
  const pt = codec === "PCMA" ? 8 : 0;

  return [
    "v=0",
    `o=pitch ${id} ${id} IN IP4 ${localHost}`,
    "s=Pitch",
    `c=IN IP4 ${localHost}`,
    "t=0 0",
    `m=audio ${localPort} RTP/AVP ${pt} 101`,
    `a=rtpmap:${pt} ${codec}/8000`,
    "a=rtpmap:101 telephone-event/8000",
    "a=fmtp:101 0-16",
    "a=ptime:20",
    "a=sendrecv",
    "",
  ].join("\r\n");
}

module.exports = { parseSdp, buildSdp };
