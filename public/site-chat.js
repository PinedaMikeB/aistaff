(function () {
  const toggle = document.getElementById("siteChatToggle");
  const panel = document.getElementById("siteChatPanel");
  const messagesEl = document.getElementById("siteChatMessages");
  const form = document.getElementById("siteChatForm");
  const input = document.getElementById("siteChatInput");
  const openBtn = document.getElementById("openSiteChatBtn");
  const iconChat = toggle?.querySelector(".icon-chat");
  const iconClose = toggle?.querySelector(".icon-close");
  const pulse = toggle?.querySelector(".site-chat-pulse");
  if (!toggle || !panel || !messagesEl || !form || !input) return;

  const STORAGE_KEY = "aistaff_site_chat_history";
  const VISITOR_KEY = "aistaff_site_chat_visitor_id";
  const INITIAL_GREETING = "Hi! I'm Closer, your AI sales agent. I help businesses like yours handle inquiries, qualify leads, and keep sales moving 24/7. How can I help you with your business today?";
  let history = [];
  let isOpen = false;
  let isSending = false;
  let visitorId = "";

  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) history = JSON.parse(saved);
  } catch {}

  try {
    visitorId = sessionStorage.getItem(VISITOR_KEY) || "";
    if (!visitorId) {
      const randomPart = window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      visitorId = `web_${String(randomPart).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)}`;
      sessionStorage.setItem(VISITOR_KEY, visitorId);
    }
  } catch {
    visitorId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function saveHistory() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history)); } catch {}
  }

  function appendTextWithLinks(node, text) {
    const value = String(text || "");
    const urlPattern = /https?:\/\/[^\s<>"']+/g;
    let lastIndex = 0;
    for (const match of value.matchAll(urlPattern)) {
      if (match.index > lastIndex) node.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
      const href = match[0].replace(/[),.;!?]+$/, "");
      const trailing = match[0].slice(href.length);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = href;
      node.appendChild(anchor);
      if (trailing) node.appendChild(document.createTextNode(trailing));
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < value.length) node.appendChild(document.createTextNode(value.slice(lastIndex)));
  }

  function imageUrlsFromText(text) {
    const urls = String(text || "").match(/https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp)(?:\?[^\s<>"']*)?/gi) || [];
    return [...new Set(urls.map((url) => url.replace(/[),.;!?]+$/, "")))];
  }

  function renderMessage(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `site-chat-bubble ${role}`;
    appendTextWithLinks(bubble, text);
    messagesEl.appendChild(bubble);
    imageUrlsFromText(text).forEach((url) => renderMedia({ type: "image", url }, ""));
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  function renderMedia(item, captionText) {
    if (!item || !item.url) return null;
    const bubble = document.createElement("div");
    bubble.className = "site-chat-bubble assistant site-chat-media-bubble";

    const link = document.createElement("a");
    link.className = "site-chat-media-link";
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    if (item.type === "image" || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(item.url)) {
      const image = document.createElement("img");
      image.src = item.url;
      image.alt = captionText || item.caption || "Shared image";
      image.loading = "lazy";
      link.appendChild(image);
    } else {
      link.textContent = item.type === "video" ? "Open video" : "Open file";
    }

    bubble.appendChild(link);
    const caption = captionText || item.caption || "";
    if (caption) {
      const captionEl = document.createElement("div");
      captionEl.className = "site-chat-media-caption";
      captionEl.textContent = caption;
      bubble.appendChild(captionEl);
    }

    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  function renderAll() {
    messagesEl.innerHTML = "";
    if (!history.length) {
      renderMessage("assistant", INITIAL_GREETING);
    } else {
      history.forEach((m) => {
        if (m.media) renderMedia(m.media, m.content);
        else renderMessage(m.role, m.content);
      });
    }
  }

  function setOpen(next) {
    isOpen = next;
    toggle.setAttribute("aria-expanded", String(next));
    if (next) {
      panel.hidden = false;
      iconChat.hidden = true;
      iconClose.hidden = false;
      pulse?.remove();
      if (typeof window.Motion !== "undefined") {
        window.Motion.animate(panel, { opacity: [0, 1], y: [16, 0], scale: [0.96, 1] },
          { duration: 0.3, easing: [0.16, 1, 0.3, 1] });
      }
      setTimeout(() => input.focus(), 50);
      renderAll();
    } else {
      iconChat.hidden = false;
      iconClose.hidden = true;
      if (typeof window.Motion !== "undefined") {
        window.Motion.animate(panel, { opacity: [1, 0], y: [0, 16], scale: [1, 0.96] },
          { duration: 0.2, easing: "ease-in" }).finished.then(() => { panel.hidden = true; });
      } else {
        panel.hidden = true;
      }
    }
  }

  toggle.addEventListener("click", () => setOpen(!isOpen));
  openBtn?.addEventListener("click", () => {
    setOpen(true);
    document.getElementById("siteChatWidget")?.scrollIntoView({ behavior: "smooth", block: "end" });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || isSending) return;

    input.value = "";
    if (!history.length) history.push({ role: "assistant", content: INITIAL_GREETING });
    history.push({ role: "user", content: text });
    renderMessage("user", text);
    saveHistory();

    isSending = true;
    const typingBubble = renderMessage("assistant typing", "···");

    try {
      const res = await fetch("/api/public/site-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, messages: history.slice(-12) })
      });
      const data = await res.json();
      typingBubble.remove();

      if (!res.ok || !data.ok) {
        renderMessage("assistant error", data.error || "Something went wrong. Please try again.");
      } else {
        const assistantMessages = [data.reply, ...(data.followUpMessages || [])].filter(Boolean);
        assistantMessages.forEach((content) => {
          history.push({ role: "assistant", content });
          renderMessage("assistant", content);
        });
        (data.media || []).forEach((item) => {
          if (!item || !item.url) return;
          const content = item.caption || "Shared media";
          history.push({ role: "assistant", content, media: item });
          renderMedia(item, content);
        });
        saveHistory();
      }
    } catch {
      typingBubble.remove();
      renderMessage("assistant error", "Could not connect. Please check your connection and try again.");
    } finally {
      isSending = false;
    }
  });
})();
