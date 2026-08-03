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
  let history = [];
  let isOpen = false;
  let isSending = false;

  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) history = JSON.parse(saved);
  } catch {}

  function saveHistory() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history)); } catch {}
  }

  function renderMessage(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `site-chat-bubble ${role}`;
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  function renderAll() {
    messagesEl.innerHTML = "";
    if (!history.length) {
      renderMessage("assistant", "Hi! I'm the AIStaff assistant. Ask me about Closer, Brandee, or pricing.");
    } else {
      history.forEach((m) => renderMessage(m.role, m.content));
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
    history.push({ role: "user", content: text });
    renderMessage("user", text);
    saveHistory();

    isSending = true;
    const typingBubble = renderMessage("assistant typing", "···");

    try {
      const res = await fetch("/api/public/site-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-12) })
      });
      const data = await res.json();
      typingBubble.remove();

      if (!res.ok || !data.ok) {
        renderMessage("assistant error", data.error || "Something went wrong. Please try again.");
      } else {
        history.push({ role: "assistant", content: data.reply });
        renderMessage("assistant", data.reply);
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
