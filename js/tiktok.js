// ============================================================================
// TIKTOK INTELLIGENCE — aba "TikTok" do painel.
// Usa a TikTok API for Developers (Login Kit + Display API). As chaves do
// app, o token de acesso e o token de atualização ficam salvos no Supabase
// (tabela tiktok_config), protegidos por login — nunca ficam escritos em
// nenhum arquivo público do site.
//
// DIFERENÇA IMPORTANTE em relação ao Instagram: o TikTok não expõe "alcance"
// nem "impressões" da conta pela API pública, só métricas por vídeo
// (curtidas, comentários, compartilhamentos, visualizações). Por isso o
// dashboard aqui tem menos cartões que o do Instagram.
//
// TOKEN DE 24H: o access_token do TikTok expira em 24 horas (diferente do
// Instagram, que dura até 60 dias). Por isso, antes de cada sincronização,
// este arquivo tenta renovar o token automaticamente usando o refresh_token
// (que dura bem mais tempo). Se a renovação falhar por bloqueio de CORS do
// navegador (a Meta permite chamadas direto do navegador para gerar token;
// já a TikTok pode não permitir isso pra proteger o client_secret), o erro
// vai aparecer na tela — nesse caso, avisar a Lucimara para que a gente
// resolva com uma Supabase Edge Function fazendo esse passo por trás.
// ============================================================================
(function () {
  const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";
  const PERFIL_ATUAL = "lucimarareis.ugc";

  // --- Estado em memória ---------------------------------------------------
  let jaIniciado = false;
  let config = null; // { client_key, client_secret, access_token, refresh_token, open_id }
  let cacheSnapshots = [];
  let cachePosts = [];
  let periodoAtual = "30d"; // "7d" | "30d" | "90d" | "personalizado"
  let periodoPersonalizadoInicio = null;
  let periodoPersonalizadoFim = null;
  let rankingAtual = "visualizacoes";

  // --------------------------------------------------------------------------
  // Utilidades
  // --------------------------------------------------------------------------
  function escapeHtml(valor) {
    if (valor === null || valor === undefined) return "";
    return String(valor)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatarNumero(valor) {
    if (valor === null || valor === undefined) return "—";
    if (typeof valor === "string" && !/^-?\d+(\.\d+)?$/.test(valor)) return valor;
    return Number(valor).toLocaleString("pt-BR");
  }

  function mostrarErro(msg) {
    const banner = document.getElementById("ttBannerErro");
    if (!banner) return;
    banner.textContent = msg;
    banner.classList.add("visivel");
  }

  function esconderErro() {
    const banner = document.getElementById("ttBannerErro");
    if (banner) banner.classList.remove("visivel");
  }

  function obterIntervaloPeriodo() {
    const fim = new Date();
    if (periodoAtual === "personalizado" && periodoPersonalizadoInicio && periodoPersonalizadoFim) {
      return { inicio: periodoPersonalizadoInicio, fim: periodoPersonalizadoFim };
    }
    const dias = { "7d": 7, "30d": 30, "90d": 90 }[periodoAtual] || 30;
    const inicio = new Date();
    inicio.setDate(inicio.getDate() - dias);
    return { inicio, fim, dias };
  }

  function dentroDoPeriodo(dataIso, inicio, fim) {
    const d = new Date(dataIso);
    return d >= inicio && d <= fim;
  }

  // ==========================================================================
  // CONEXÃO — carregar/salvar config no Supabase
  // ==========================================================================
  async function carregarConfig() {
    const { data, error } = await sb
      .from("tiktok_config")
      .select("*")
      .eq("perfil", PERFIL_ATUAL)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function salvarConfig(dados) {
    const { error } = await sb
      .from("tiktok_config")
      .upsert(
        { perfil: PERFIL_ATUAL, ...dados, updated_at: new Date().toISOString() },
        { onConflict: "perfil" }
      );
    if (error) throw error;
  }

  // ==========================================================================
  // CARREGAMENTO DO CACHE LOCAL (Supabase) — sem chamar a API do TikTok
  // ==========================================================================
  async function carregarCacheLocal() {
    const [snapshots, posts] = await Promise.all([
      sb.from("tiktok_snapshots").select("*").eq("perfil", PERFIL_ATUAL).order("data", { ascending: true }),
      sb.from("tiktok_posts").select("*").eq("perfil", PERFIL_ATUAL).order("publicado_em", { ascending: false }),
    ]);
    if (snapshots.error) throw snapshots.error;
    if (posts.error) throw posts.error;
    cacheSnapshots = snapshots.data || [];
    cachePosts = posts.data || [];
  }

  // ==========================================================================
  // RENOVAÇÃO DO TOKEN — o access_token do TikTok expira em 24h
  // ==========================================================================
  async function renovarTokenSeNecessario() {
    if (!config.refresh_token) return;
    const resposta = await fetch(`${TIKTOK_API_BASE}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: config.client_key,
        client_secret: config.client_secret,
        grant_type: "refresh_token",
        refresh_token: config.refresh_token,
      }),
    });
    const corpo = await resposta.json();
    if (corpo.error) throw new Error(corpo.error_description || "Não foi possível renovar o token do TikTok.");

    config.access_token = corpo.access_token;
    config.refresh_token = corpo.refresh_token || config.refresh_token;
    config.open_id = corpo.open_id || config.open_id;
    await salvarConfig({
      client_key: config.client_key,
      client_secret: config.client_secret,
      access_token: config.access_token,
      refresh_token: config.refresh_token,
      open_id: config.open_id,
    });
  }

  // ==========================================================================
  // SINCRONIZAÇÃO — busca dados novos na TikTok API
  // ==========================================================================
  async function chamarTikTokApi(caminho, corpo) {
    const resposta = await fetch(`${TIKTOK_API_BASE}/${caminho}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.access_token}`,
      },
      body: JSON.stringify(corpo || {}),
    });
    const dados = await resposta.json();
    if (dados.error && dados.error.code !== "ok") throw new Error(dados.error.message || "Erro na API do TikTok");
    return dados;
  }

  function chaveDia(data) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, "0");
    const dia = String(data.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  }

  async function sincronizar() {
    if (!config) return;
    esconderErro();
    const botao = document.getElementById("botaoSincronizarTikTok");
    if (botao) { botao.disabled = true; botao.classList.add("girando"); }

    try {
      await renovarTokenSeNecessario();

      // --- Dados básicos + estatísticas da conta ---
      const conta = await chamarTikTokApi(
        "user/info/?fields=open_id,display_name,follower_count,following_count,likes_count,video_count"
      );
      const campos = conta.data?.user || {};

      const hoje = chaveDia(new Date());
      await sb.from("tiktok_snapshots").upsert(
        {
          perfil: PERFIL_ATUAL,
          data: hoje,
          seguidores: campos.follower_count ?? null,
          seguindo: campos.following_count ?? null,
          publicacoes: campos.video_count ?? null,
          curtidas_totais: campos.likes_count ?? null,
        },
        { onConflict: "perfil,data" }
      );

      // --- Vídeos recentes ---
      const videos = await chamarTikTokApi(
        "video/list/?fields=id,title,cover_image_url,share_url,create_time,like_count,comment_count,share_count,view_count",
        { max_count: 20 }
      );

      for (const video of videos.data?.videos || []) {
        await sb.from("tiktok_posts").upsert(
          {
            id: video.id,
            perfil: PERFIL_ATUAL,
            titulo: video.title || null,
            capa_url: video.cover_image_url || null,
            link: video.share_url || null,
            publicado_em: video.create_time ? new Date(video.create_time * 1000).toISOString() : null,
            curtidas: video.like_count ?? null,
            comentarios: video.comment_count ?? null,
            compartilhamentos: video.share_count ?? null,
            visualizacoes: video.view_count ?? null,
            atualizado_em: new Date().toISOString(),
          },
          { onConflict: "id" }
        );
      }

      await carregarCacheLocal();
      renderizarTudo();
    } catch (erro) {
      console.error(erro);
      mostrarErro(
        "Não foi possível sincronizar com o TikTok agora. Detalhe: " + erro.message
      );
    } finally {
      if (botao) { botao.disabled = false; botao.classList.remove("girando"); }
    }
  }

  // ==========================================================================
  // RENDERIZAÇÃO — DASHBOARD
  // ==========================================================================
  function snapshotMaisProximo(dataAlvo) {
    const candidatos = cacheSnapshots.filter((s) => new Date(s.data) <= dataAlvo);
    return candidatos.length ? candidatos[candidatos.length - 1] : null;
  }

  function cartaoNumero(valor, rotulo, delta, destaque) {
    let deltaHtml = "";
    if (delta !== null && delta !== undefined) {
      const positivo = delta >= 0;
      deltaHtml = `<div class="ig-metrica-delta ${positivo ? "positivo" : "negativo"}">${positivo ? "+" : ""}${formatarNumero(delta)} vs período anterior</div>`;
    }
    return `
      <div class="cartao-numero ${destaque ? "destaque" : ""}">
        <div class="cartao-numero-numero">${formatarNumero(valor)}</div>
        <div class="cartao-numero-rotulo">${rotulo}</div>
        ${deltaHtml}
      </div>`;
  }

  function engajamentoDoPost(p) {
    return (Number(p.curtidas) || 0) + (Number(p.comentarios) || 0) + (Number(p.compartilhamentos) || 0);
  }

  function renderizarDashboard() {
    const container = document.getElementById("ttDashboard");
    if (!container) return;

    if (!cacheSnapshots.length) {
      container.innerHTML = `<p class="estado-vazio">Clique em "Sincronizar" para trazer os primeiros dados da sua conta.</p>`;
      return;
    }

    const { inicio, fim } = obterIntervaloPeriodo();

    const ultimoSnapshot = cacheSnapshots[cacheSnapshots.length - 1];
    const snapshotInicioPeriodo = snapshotMaisProximo(inicio);

    const seguidoresAtuais = ultimoSnapshot?.seguidores ?? null;
    const seguidoresGanhos =
      seguidoresAtuais !== null && snapshotInicioPeriodo?.seguidores !== null && snapshotInicioPeriodo !== null
        ? seguidoresAtuais - snapshotInicioPeriodo.seguidores
        : null;

    const postsNoPeriodo = cachePosts.filter((p) => p.publicado_em && dentroDoPeriodo(p.publicado_em, inicio, fim));
    const visualizacoesPeriodo = postsNoPeriodo.reduce((s, p) => s + (Number(p.visualizacoes) || 0), 0);
    const somaEngajamento = postsNoPeriodo.reduce((s, p) => s + engajamentoDoPost(p), 0);
    const taxaBruta = visualizacoesPeriodo > 0 ? (somaEngajamento / visualizacoesPeriodo) * 100 : NaN;
    const taxaEngajamento = Number.isFinite(taxaBruta) ? taxaBruta.toFixed(1) : null;

    container.innerHTML = [
      cartaoNumero(seguidoresAtuais, "Seguidores atuais", null, true),
      cartaoNumero(seguidoresGanhos, "Seguidores ganhos no período"),
      cartaoNumero(ultimoSnapshot?.curtidas_totais ?? null, "Curtidas totais do perfil"),
      cartaoNumero(visualizacoesPeriodo, "Visualizações no período"),
      cartaoNumero(postsNoPeriodo.length, "Vídeos publicados no período"),
      cartaoNumero(taxaEngajamento !== null ? `${taxaEngajamento}%` : null, "Taxa de engajamento"),
    ].join("");
  }

  function renderizarGraficoSeguidores() {
    const container = document.getElementById("ttGraficoSeguidores");
    if (!container) return;

    const { inicio, fim } = obterIntervaloPeriodo();
    const doPeriodo = cacheSnapshots.filter((s) => dentroDoPeriodo(s.data, inicio, fim));

    if (!doPeriodo.length) {
      container.innerHTML = `<p class="estado-vazio">Ainda não há snapshots suficientes neste período. Sincronize em dias diferentes para o gráfico ir se formando.</p>`;
      return;
    }

    const valores = doPeriodo.map((s) => Number(s.seguidores) || 0);
    const maximo = Math.max(1, ...valores);
    const minimo = Math.min(...valores);

    container.innerHTML = doPeriodo
      .map((s) => {
        const valor = Number(s.seguidores) || 0;
        const altura = maximo === minimo ? 60 : Math.max(Math.round(((valor - minimo) / (maximo - minimo)) * 100), 4);
        const dataFormatada = new Date(s.data).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
        return `
          <div class="barra-dia">
            <div class="barra-tooltip">${dataFormatada}: ${formatarNumero(valor)} seguidores</div>
            <div class="barra-coluna" style="height:${altura}%"></div>
          </div>`;
      })
      .join("");
  }

  // ==========================================================================
  // RENDERIZAÇÃO — INSIGHTS (regras simples, sem IA)
  // ==========================================================================
  function resumirLegenda(legenda, tamanho) {
    if (!legenda) return "(sem legenda)";
    const limpa = legenda.replace(/\s+/g, " ").trim();
    return limpa.length > tamanho ? limpa.slice(0, tamanho).trim() + "…" : limpa;
  }

  function renderizarInsights() {
    const container = document.getElementById("ttInsights");
    if (!container) return;

    const { inicio, fim } = obterIntervaloPeriodo();
    const posts = cachePosts.filter((p) => p.publicado_em && dentroDoPeriodo(p.publicado_em, inicio, fim));

    if (posts.length < 3) {
      container.innerHTML = `<p class="estado-vazio">Ainda não há vídeos suficientes neste período para gerar insights. Sincronize novamente depois de publicar mais conteúdo.</p>`;
      return;
    }

    const itens = [];

    const porVisualizacoes = [...posts].sort((a, b) => (Number(b.visualizacoes) || 0) - (Number(a.visualizacoes) || 0))[0];
    if (porVisualizacoes && porVisualizacoes.visualizacoes) {
      itens.push(`Seu vídeo com mais visualizações foi <strong>"${escapeHtml(resumirLegenda(porVisualizacoes.titulo, 60))}"</strong>, com ${formatarNumero(porVisualizacoes.visualizacoes)} visualizações.`);
    }

    const porEngajamento = [...posts].sort((a, b) => engajamentoDoPost(b) - engajamentoDoPost(a))[0];
    if (porEngajamento) {
      itens.push(`Seu vídeo com maior engajamento foi <strong>"${escapeHtml(resumirLegenda(porEngajamento.titulo, 60))}"</strong>, com ${formatarNumero(engajamentoDoPost(porEngajamento))} interações.`);
    }

    const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
    const porDiaSemana = {};
    posts.forEach((p) => {
      const dia = new Date(p.publicado_em).getDay();
      (porDiaSemana[dia] = porDiaSemana[dia] || []).push(p);
    });
    const mediaPorDia = Object.entries(porDiaSemana)
      .filter(([, lista]) => lista.length >= 1)
      .map(([dia, lista]) => ({ dia: Number(dia), media: lista.reduce((s, p) => s + engajamentoDoPost(p), 0) / lista.length }));
    if (mediaPorDia.length > 1) {
      const melhorDia = mediaPorDia.sort((a, b) => b.media - a.media)[0];
      itens.push(`Seu melhor dia para postar parece ser <strong>${DIAS[melhorDia.dia]}</strong>, com mais engajamento médio que os outros dias.`);
    }

    itens.push(`Você publicou <strong>${posts.length}</strong> vídeos no período selecionado.`);

    container.innerHTML = itens.map((texto) => `<div class="ig-insight-item">${texto}</div>`).join("");
  }

  // ==========================================================================
  // RENDERIZAÇÃO — RANKING (Top 10)
  // ==========================================================================
  function renderizarRanking() {
    const container = document.getElementById("ttRanking");
    if (!container) return;

    const { inicio, fim } = obterIntervaloPeriodo();
    const posts = cachePosts.filter((p) => p.publicado_em && dentroDoPeriodo(p.publicado_em, inicio, fim));

    const valorDoRanking = {
      visualizacoes: (p) => Number(p.visualizacoes) || 0,
      engajamento: (p) => engajamentoDoPost(p),
      compartilhamentos: (p) => Number(p.compartilhamentos) || 0,
      curtidas: (p) => Number(p.curtidas) || 0,
    }[rankingAtual];

    const ordenado = [...posts].sort((a, b) => valorDoRanking(b) - valorDoRanking(a)).slice(0, 10);

    if (!ordenado.length) {
      container.innerHTML = `<p class="estado-vazio">Nenhum vídeo com dados suficientes neste período.</p>`;
      return;
    }

    const maximo = Math.max(1, valorDoRanking(ordenado[0]));

    container.innerHTML = ordenado
      .map((p) => {
        const largura = Math.round((valorDoRanking(p) / maximo) * 100);
        return `
          <div class="item-barra-horizontal" data-id="${p.id}">
            <div class="item-barra-cabecalho">
              <span>${escapeHtml(resumirLegenda(p.titulo, 50))}</span>
              <strong>${formatarNumero(valorDoRanking(p))}</strong>
            </div>
            <div class="barra-horizontal"><div class="barra-horizontal-preenchida" style="width:${largura}%"></div></div>
          </div>`;
      })
      .join("");

    container.querySelectorAll("[data-id]").forEach((el) => {
      el.style.cursor = "pointer";
      el.addEventListener("click", () => abrirDetalhePost(el.dataset.id));
    });
  }

  // ==========================================================================
  // RENDERIZAÇÃO — ÚLTIMAS POSTAGENS + DETALHE
  // ==========================================================================
  function renderizarPosts() {
    const container = document.getElementById("ttPosts");
    if (!container) return;

    const { inicio, fim } = obterIntervaloPeriodo();
    const posts = cachePosts.filter((p) => p.publicado_em && dentroDoPeriodo(p.publicado_em, inicio, fim));

    if (!posts.length) {
      container.innerHTML = `<p class="estado-vazio">Nenhum vídeo neste período.</p>`;
      return;
    }

    container.innerHTML = posts
      .map((p) => {
        const dataFormatada = p.publicado_em ? new Date(p.publicado_em).toLocaleDateString("pt-BR") : "";
        return `
          <div class="ig-post-card" data-id="${p.id}">
            <div class="ig-post-thumb" style="background-image:url('${escapeHtml(p.capa_url || "")}')">
              <span class="ig-post-tipo">Vídeo</span>
            </div>
            <div class="ig-post-info">
              <p class="ig-post-data">${dataFormatada}</p>
              <p class="ig-post-legenda">${escapeHtml(resumirLegenda(p.titulo, 90))}</p>
              <div class="ig-post-metricas">
                <span>❤ <strong>${formatarNumero(p.curtidas)}</strong></span>
                <span>💬 <strong>${formatarNumero(p.comentarios)}</strong></span>
                <span>↗ <strong>${formatarNumero(p.compartilhamentos)}</strong></span>
                <span>▶ <strong>${formatarNumero(p.visualizacoes)}</strong></span>
              </div>
            </div>
          </div>`;
      })
      .join("");

    container.querySelectorAll(".ig-post-card").forEach((el) => {
      el.addEventListener("click", () => abrirDetalhePost(el.dataset.id));
    });
  }

  function abrirDetalhePost(id) {
    const post = cachePosts.find((p) => p.id === id);
    if (!post) return;

    const dataFormatada = post.publicado_em
      ? new Date(post.publicado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";

    document.getElementById("ttModalConteudo").innerHTML = `
      <div class="ig-post-thumb" style="background-image:url('${escapeHtml(post.capa_url || "")}'); aspect-ratio: 4/5; border-radius: 16px; margin-bottom: 18px;">
        <span class="ig-post-tipo">Vídeo</span>
      </div>
      <p class="ig-post-data">${dataFormatada}</p>
      <p style="font-size:14px; line-height:1.6; margin: 8px 0 18px;">${escapeHtml(post.titulo || "(sem título)")}</p>
      <div class="grade-numeros" style="grid-template-columns: repeat(2, 1fr); margin-bottom: 0;">
        ${cartaoNumero(post.curtidas, "Curtidas")}
        ${cartaoNumero(post.comentarios, "Comentários")}
        ${cartaoNumero(post.compartilhamentos, "Compartilhamentos")}
        ${cartaoNumero(post.visualizacoes, "Visualizações")}
      </div>
      ${post.link ? `<p style="margin-top:18px;"><a href="${escapeHtml(post.link)}" target="_blank" rel="noopener" class="botao-acao">Ver no TikTok</a></p>` : ""}
    `;
    document.getElementById("ttModalPost").classList.add("ativo");
  }

  function fecharDetalhePost() {
    document.getElementById("ttModalPost").classList.remove("ativo");
  }

  // ==========================================================================
  // RENDERIZAÇÃO GERAL
  // ==========================================================================
  function renderizarTudo() {
    const ultimaSync = document.getElementById("ttUltimaSincronizacao");
    if (ultimaSync && config?.updated_at) {
      ultimaSync.textContent = `Última sincronização: ${new Date(config.updated_at).toLocaleString("pt-BR")}`;
    }
    renderizarDashboard();
    renderizarGraficoSeguidores();
    renderizarInsights();
    renderizarRanking();
    renderizarPosts();
  }

  // ==========================================================================
  // INTERAÇÕES
  // ==========================================================================
  function ligarEventos() {
    document.getElementById("formConexaoTikTok").addEventListener("submit", async (e) => {
      e.preventDefault();
      const clientKey = document.getElementById("ttClientKey").value.trim();
      const clientSecret = document.getElementById("ttClientSecret").value.trim();
      const accessToken = document.getElementById("ttAccessToken").value.trim();
      const refreshToken = document.getElementById("ttRefreshToken").value.trim();
      if (!clientKey || !clientSecret || !accessToken) return;

      const botao = e.target.querySelector("button[type=submit]");
      botao.disabled = true;
      botao.textContent = "Conectando...";

      try {
        const dados = { client_key: clientKey, client_secret: clientSecret, access_token: accessToken, refresh_token: refreshToken || null };
        await salvarConfig(dados);
        config = dados;
        document.getElementById("ttConexao").classList.add("oculto");
        document.getElementById("ttConteudo").classList.remove("oculto");
        await sincronizar();
      } catch (erro) {
        console.error(erro);
        mostrarErro("Não foi possível salvar a conexão. Confira as chaves e o token e tente novamente.");
      } finally {
        botao.disabled = false;
        botao.textContent = "Conectar";
      }
    });

    document.getElementById("botaoSincronizarTikTok").addEventListener("click", sincronizar);

    document.getElementById("botaoEditarConexaoTikTok").addEventListener("click", () => {
      document.getElementById("ttClientKey").value = config?.client_key || "";
      document.getElementById("ttClientSecret").value = config?.client_secret || "";
      document.getElementById("ttAccessToken").value = "";
      document.getElementById("ttRefreshToken").value = config?.refresh_token || "";
      document.getElementById("ttConexao").classList.remove("oculto");
      document.getElementById("ttConteudo").classList.add("oculto");
    });

    document.querySelectorAll('[data-tt-periodo]').forEach((botao) => {
      botao.addEventListener("click", () => {
        document.querySelectorAll('[data-tt-periodo]').forEach((b) => b.classList.remove("ativo"));
        botao.classList.add("ativo");
        periodoAtual = botao.dataset.ttPeriodo;
        document.getElementById("ttPeriodoPersonalizado").classList.toggle("oculto", periodoAtual !== "personalizado");
        if (periodoAtual !== "personalizado") renderizarTudo();
      });
    });

    document.getElementById("ttAplicarPersonalizado").addEventListener("click", () => {
      const inicio = document.getElementById("ttDataInicio").value;
      const fim = document.getElementById("ttDataFim").value;
      if (!inicio || !fim) return;
      periodoPersonalizadoInicio = new Date(inicio);
      periodoPersonalizadoFim = new Date(fim);
      renderizarTudo();
    });

    document.querySelectorAll('[data-tt-ranking]').forEach((botao) => {
      botao.addEventListener("click", () => {
        document.querySelectorAll('[data-tt-ranking]').forEach((b) => b.classList.remove("ativo"));
        botao.classList.add("ativo");
        rankingAtual = botao.dataset.ttRanking;
        renderizarRanking();
      });
    });

    document.getElementById("ttModalFechar").addEventListener("click", fecharDetalhePost);
    document.getElementById("ttModalPost").addEventListener("click", (e) => {
      if (e.target.id === "ttModalPost") fecharDetalhePost();
    });
  }

  // ==========================================================================
  // INICIALIZAÇÃO — chamada pelo painel na primeira vez que a aba abre
  // ==========================================================================
  async function iniciar() {
    if (jaIniciado) return;
    jaIniciado = true;
    ligarEventos();

    try {
      config = await carregarConfig();
    } catch (erro) {
      console.error(erro);
      mostrarErro("Não foi possível verificar a conexão com o TikTok.");
      return;
    }

    if (!config) {
      document.getElementById("ttConexao").classList.remove("oculto");
      document.getElementById("ttConteudo").classList.add("oculto");
      return;
    }

    document.getElementById("ttConexao").classList.add("oculto");
    document.getElementById("ttConteudo").classList.remove("oculto");

    try {
      await carregarCacheLocal();
      renderizarTudo();
    } catch (erro) {
      console.error(erro);
      mostrarErro("Não foi possível carregar os dados salvos do TikTok.");
    }
  }

  window.TikTokIntelligence = { iniciar };
})();
