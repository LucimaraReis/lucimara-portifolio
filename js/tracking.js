// ============================================================================
// RASTREAMENTO DO SITE — grava visitas, cliques e mensagens no Supabase.
// Usa a chave anon (pública) só para GRAVAR (nunca lê nada daqui).
// ============================================================================
(function () {
  const SUPABASE_URL = "https://eeoevhxlykbbauqvvtbv.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlb2V2aHhseWtiYmF1cXZ2dGJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NjY4OTYsImV4cCI6MjA5OTU0Mjg5Nn0.UaLDHg5ItHxXVxGHKHQAAnjqtWK0RsAlltMiBsVDVE0";

  const sbTracking = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // --- Identifica a sessão do visitante (não é login, só um id aleatório) ---
  function obterSessionId() {
    let id = sessionStorage.getItem("lp_session_id");
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem("lp_session_id", id);
    }
    return id;
  }

  // --- Transforma texto livre em um nome de evento (sem acento, sem espaço) ---
  function slugificar(texto) {
    return (texto || "")
      .toString()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  // --- Grava um evento, sem travar o site se o Supabase falhar ---
  function trackEvent(eventType, eventName, metadata) {
    sbTracking
      .from("portfolio_events")
      .insert({
        event_type: eventType,
        event_name: eventName || null,
        session_id: obterSessionId(),
        page_path: window.location.pathname,
        metadata: metadata || null,
      })
      .then(({ error }) => {
        if (error) console.warn("Falha ao registrar evento:", error.message);
      });
  }

  // --- Grava uma mensagem de contato ---
  function trackLead(lead) {
    sbTracking
      .from("portfolio_leads")
      .insert(lead)
      .then(({ error }) => {
        if (error) console.warn("Falha ao registrar mensagem:", error.message);
      });
  }

  // --- Visita à página ---
  trackEvent("page_view", null, { title: document.title });

  document.addEventListener("DOMContentLoaded", () => {
    // --- Qualquer clique de navegação por âncora (menu, CTAs, "vamos criar") ---
    // Cobre: menu do topo, menu mobile, botões do hero e o CTA de serviços,
    // já que todos apontam para uma seção real da página (#sobre, #contato...).
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      const alvo = link.getAttribute("href").slice(1);
      if (!alvo || link.classList.contains("logo")) return;
      link.addEventListener("click", () => trackEvent("button_click", "menu_" + slugificar(alvo)));
    });

    // --- Cliques nos links de contato (WhatsApp, e-mail, Instagram, TikTok) ---
    document.querySelectorAll(".socials a").forEach((link) => {
      const href = link.getAttribute("href") || "";
      let nome = null;
      if (href.includes("wa.me")) nome = "contact_whatsapp";
      else if (href.startsWith("mailto:")) nome = "contact_email";
      else if (href.includes("instagram.com")) nome = "contact_instagram";
      else if (href.includes("tiktok.com")) nome = "contact_tiktok";
      if (nome) link.addEventListener("click", () => trackEvent("button_click", nome));
    });

    // --- Cliques nos filtros de categoria do portfólio ---
    // Delegado no container, porque os botões são gerados dinamicamente.
    const filtersEl = document.getElementById("filters");
    if (filtersEl) {
      filtersEl.addEventListener("click", (e) => {
        const botao = e.target.closest(".filter-btn");
        if (!botao) return;
        trackEvent("button_click", "filtro_" + slugificar(botao.textContent));
      });
    }

    // --- Cliques nos cards de vídeo do portfólio ---
    // Delegado no container, porque os cards são recriados a cada filtro.
    // Usa o ID real do YouTube quando existir (data-video-id), senão usa o
    // título como identificador provisório até o vídeo real ser cadastrado.
    const gridEl = document.getElementById("portfolioGrid");
    if (gridEl) {
      gridEl.addEventListener("click", (e) => {
        const card = e.target.closest(".video-card");
        if (!card) return;
        const titulo = card.querySelector(".video-title")?.textContent || "video";
        const idReal = card.dataset.videoId;
        const idEvento = idReal && idReal.trim() ? idReal.trim() : slugificar(titulo);
        trackEvent("video_view", idEvento, { title: titulo });
      });
    }

    // --- Envio do formulário de contato (seção "contato") ---
    const contactForm = document.getElementById("contactForm");
    if (contactForm) {
      contactForm.addEventListener("submit", () => {
        trackEvent("button_click", "contact_formulario_contato");
        trackLead({
          name: document.getElementById("c-nome")?.value || null,
          email: document.getElementById("c-email")?.value || null,
          phone: document.getElementById("c-whats")?.value || null,
          brand: document.getElementById("c-empresa")?.value || null,
          message: document.getElementById("c-briefing")?.value || null,
          source: "contact",
        });
      });
    }

    // --- Envio do formulário do pop-up ---
    const popupForm = document.getElementById("popupForm");
    if (popupForm) {
      popupForm.addEventListener("submit", () => {
        trackEvent("button_click", "contact_formulario_popup");
        trackLead({
          name: document.getElementById("p-nome")?.value || null,
          email: document.getElementById("p-email")?.value || null,
          phone: document.getElementById("p-whats")?.value || null,
          brand: document.getElementById("p-empresa")?.value || null,
          message: document.getElementById("p-briefing")?.value || null,
          source: "popup",
        });
      });
    }
  });
})();
