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
    // --- Cliques nos botões de "trabalhe comigo" / "vamos criar" (levam a #contato) ---
    document.querySelectorAll('a[href="#contato"]').forEach((link) => {
      link.addEventListener("click", () => trackEvent("button_click", "trabalhar_comigo"));
    });

    // --- Cliques no botão "ver portfólio" ---
    document.querySelectorAll('a[href="#portfolio"]').forEach((link) => {
      link.addEventListener("click", () => trackEvent("button_click", "ver_portfolio"));
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

    // --- Vídeos do portfólio ---
    // Quando os cards de vídeo (placeholder-img dentro de #portfolioGrid) forem
    // trocados por vídeos reais do YouTube, adicione aqui uma chamada como:
    //   trackEvent('video_view', 'ID_DO_VIDEO_NO_YOUTUBE', { title: 'Título do vídeo' });
    // no clique de cada card, para esses dados aparecerem na aba Portfólio do painel.
  });
})();
