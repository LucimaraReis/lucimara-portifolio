// ============================================================================
// INSTAGRAM INTELLIGENCE — aba "Instagram" do painel.
// Usa a Instagram Graph API oficial da Meta. O token de acesso e o ID da
// conta ficam salvos no Supabase (tabela instagram_config), protegidos por
// login — nunca ficam escritos em nenhum arquivo público do site.
//
// IMPORTANTE sobre a Graph API: a Meta muda os nomes de algumas métricas de
// tempos em tempos e aposenta versões antigas da API a cada ~2 anos. Se algum
// dia a sincronização começar a dar erro, o primeiro lugar a checar é a
// constante GRAPH_API_VERSION abaixo e a documentação oficial em
// developers.facebook.com/docs/instagram-api.
// ============================================================================
(function () {
  const GRAPH_API_VERSION = "v21.0";
  const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
  const PERFIL_ATUAL = "lucimarareis.ugc"; // preparado para múltiplos perfis no futuro

  // --- Estado em memória ---------------------------------------------------
  let jaIniciado = false;
  let config = null; // { ig_user_id, access_token }
  let cacheSnapshots = [];
  let cachePosts = [];
  let periodoAtual = "30d"; // "7d" | "30d" | "90d" | "personalizado"
  let periodoPersonalizadoInicio = null;
  let periodoPersonalizadoFim = null;
  let rankingAtual = "alcance";

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

  function chaveDia(data) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, "0");
    const dia = String(data.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  }

  function formatarNumero(valor) {
    if (valor === null || valor === undefined) return "—";
    return Number(valor).toLocaleString("pt-BR");
  }

  function mostrarErro(msg) {
    const banner = document.getElementById("igBannerErro");
    if (!banner) return;
    banner.textContent = msg;
    banner.classList.add("visivel");
  }

  function esconderErro() {
    const banner = document.getElementById("igBannerErro");
    if (banner) banner.classList.remove("visivel");
  }

  // --------------------------------------------------------------------------
  // Período selecionado: devolve { inicio: Date, fim: Date, dias: number }
  // --------------------------------------------------------------------------
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
  // CONEXÃO — carregar/salvar config (ig_user_id + token) no Supabase
  // ==========================================================================
  async function carregarConfig() {
    const { data, error } = await sb
      .from("instagram_config")
      .select("*")
      .eq("perfil", PERFIL_ATUAL)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function salvarConfig(igUserId, accessToken) {
    const { error } = await sb
      .from("instagram_config")
      .upsert(
        { perfil: PERFIL_ATUAL, ig_user_id: igUserId, access_token: accessToken, updated_at: new Date().toISOString() },
        { onConflict: "perfil" }
      );
    if (error) throw error;
  }

  // ==========================================================================
  // CARREGAMENTO DO CACHE LOCAL (Supabase) — sem chamar a Graph API
  // ==========================================================================
  async function carregarCacheLocal() {
    const [snapshots, posts] = await Promise.all([
      sb.from("instagram_snapshots").select("*").eq("perfil", PERFIL_ATUAL).order("data", { ascending: true }),
      sb.from("instagram_posts").select("*").eq("perfil", PERFIL_ATUAL).order("publicado_em", { ascending: false }),
    ]);
    if (snapshots.error) throw snapshots.error;
    if (posts.error) throw posts.error;
    cacheSnapshots = snapshots.data || [];
    cachePosts = posts.data || [];
  }

  // ==========================================================================
  // SINCRONIZAÇÃO — busca dados novos na Instagram Graph API
  // ==========================================================================
  async function chamarGraphApi(caminho, params) {
    const url = new URL(`${GRAPH_API_BASE}/${caminho}`);
    Object.entries(params || {}).forEach(([chave, valor]) => url.searchParams.set(chave, valor));
    url.searchParams.set("access_token", config.access_token);
    const resposta = await fetch(url.toString());
    const corpo = await resposta.json();
    if (corpo.error) throw new Error(corpo.error.message || "Erro na Instagram Graph API");
    return corpo;
  }

  async function sincronizar() {
    if (!config) return;
    esconderErro();
    const botao = document.getElementById("botaoSincronizarInstagram");
    if (botao) { botao.disabled = true; botao.classList.add("girando"); }

    try {
      // --- Dados básicos da conta ---
      const conta = await chamarGraphApi(config.ig_user_id, {
        fields: "followers_count,follows_count,media_count,username",
      });

      // --- Insights diários da conta (últimos 30 dias, é o limite útil da API) ---
      let insightsConta = { data: [] };
      try {
        insightsConta = await chamarGraphApi(`${config.ig_user_id}/insights`, {
          metric: "reach,impressions,profile_views,website_clicks",
          period: "day",
        });
      } catch (erroInsights) {
        console.warn("Não foi possível buscar os insights diários da conta:", erroInsights.message);
      }

      const porMetrica = {};
      (insightsConta.data || []).forEach((m) => {
        porMetrica[m.name] = m.values || [];
      });

      // Grava um snapshot de hoje com o valor mais recente de cada métrica
      const hoje = chaveDia(new Date());
      const ultimoValor = (nome) => {
        const valores = porMetrica[nome];
        if (!valores || !valores.length) return null;
        return valores[valores.length - 1].value ?? null;
      };
      await sb.from("instagram_snapshots").upsert(
        {
          perfil: PERFIL_ATUAL,
          data: hoje,
          seguidores: conta.followers_count ?? null,
          seguindo: conta.follows_count ?? null,
          publicacoes: conta.media_count ?? null,
          alcance: ultimoValor("reach"),
          impressoes: ultimoValor("impressions"),
          visitas_perfil: ultimoValor("profile_views"),
          cliques_link: ultimoValor("website_clicks"),
        },
        { onConflict: "perfil,data" }
      );

      // --- Publicações recentes ---
      const midias = await chamarGraphApi(config.ig_user_id, {
        fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
        limit: 50,
      });

      for (const post of midias.data || []) {
        let metricas = {};
        try {
          const ehReel = post.media_product_type === "REELS";
          const listaMetricas = ehReel
            ? "reach,saved,shares,plays,total_interactions"
            : "reach,saved,shares";
          const insightsPost = await chamarGraphApi(`${post.id}/insights`, { metric: listaMetricas });
          (insightsPost.data || []).forEach((m) => {
            metricas[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? null;
          });
        } catch (erroPost) {
          // Nem toda publicação tem insights disponíveis (ex.: posts muito antigos) — segue sem travar a sincronização
          console.warn(`Sem insights para a publicação ${post.id}:`, erroPost.message);
        }

        await sb.from("instagram_posts").upsert(
          {
            id: post.id,
            perfil: PERFIL_ATUAL,
            tipo: post.media_type || null,
            is_reel: post.media_product_type === "REELS",
            legenda: post.caption || null,
            permalink: post.permalink || null,
            midia_url: post.media_url || null,
            thumbnail_url: post.thumbnail_url || post.media_url || null,
            publicado_em: post.timestamp || null,
            curtidas: post.like_count ?? null,
            comentarios: post.comments_count ?? null,
            compartilhamentos: metricas.shares ?? null,
            salvamentos: metricas.saved ?? null,
            alcance: metricas.reach ?? null,
            impressoes: metricas.impressions ?? null,
            plays: metricas.plays ?? null,
            atualizado_em: new Date().toISOString(),
          },
          { onConflict: "id" }
        );
      }

      await sb.from("instagram_config").update({ updated_at: new Date().toISOString() }).eq("perfil", PERFIL_ATUAL);

      await carregarCacheLocal();
      renderizarTudo();
    } catch (erro) {
      console.error(erro);
      mostrarErro(
        "Não foi possível sincronizar com o Instagram agora. Confira se o token de acesso ainda é válido (ele expira periodicamente). Detalhe: " +
          erro.message
      );
    } finally {
      if (botao) { botao.disabled = false; botao.classList.remove("girando"); }
    }
  }

  // ==========================================================================
  // RENDERIZAÇÃO — DASHBOARD
  // ==========================================================================
  function snapshotMaisProximo(dataAlvo) {
    // Acha o snapshot com data mais próxima (e não posterior) da data alvo
    const candidatos = cacheSnapshots.filter((s) => new Date(s.data) <= dataAlvo);
    return candidatos.length ? candidatos[candidatos.length - 1] : null;
  }

  function somarNoPeriodo(campo, inicio, fim) {
    return cacheSnapshots
      .filter((s) => dentroDoPeriodo(s.data, inicio, fim))
      .reduce((soma, s) => soma + (Number(s[campo]) || 0), 0);
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

  function renderizarDashboard() {
    const container = document.getElementById("igDashboard");
    if (!container) return;

    if (!cacheSnapshots.length) {
      container.innerHTML = `<p class="estado-vazio">Clique em "Sincronizar" para trazer os primeiros dados da sua conta.</p>`;
      return;
    }

    const { inicio, fim } = obterIntervaloPeriodo();
    const duracaoMs = fim - inicio;
    const inicioAnterior = new Date(inicio.getTime() - duracaoMs);
    const fimAnterior = new Date(inicio.getTime());

    const ultimoSnapshot = cacheSnapshots[cacheSnapshots.length - 1];
    const snapshotInicioPeriodo = snapshotMaisProximo(inicio);

    const seguidoresAtuais = ultimoSnapshot?.seguidores ?? null;
    const seguidoresGanhos =
      seguidoresAtuais !== null && snapshotInicioPeriodo?.seguidores !== null && snapshotInicioPeriodo !== null
        ? seguidoresAtuais - snapshotInicioPeriodo.seguidores
        : null;

    const alcance = somarNoPeriodo("alcance", inicio, fim);
    const alcanceAnterior = somarNoPeriodo("alcance", inicioAnterior, fimAnterior);
    const impressoes = somarNoPeriodo("impressoes", inicio, fim);
    const impressoesAnterior = somarNoPeriodo("impressoes", inicioAnterior, fimAnterior);
    const visitasPerfil = somarNoPeriodo("visitas_perfil", inicio, fim);
    const cliquesLink = somarNoPeriodo("cliques_link", inicio, fim);

    const postsNoPeriodo = cachePosts.filter((p) => p.publicado_em && dentroDoPeriodo(p.publicado_em, inicio, fim));
    const totalReels = postsNoPeriodo.filter((p) => p.is_reel).length;

    const somaEngajamento = postsNoPeriodo.reduce(
      (s, p) => s + (Number(p.curtidas) || 0) + (Number(p.comentarios) || 0) + (Number(p.salvamentos) || 0) + (Number(p.compartilhamentos) || 0),
      0
    );
    const somaAlcancePosts = postsNoPeriodo.reduce((s, p) => s + (Number(p.alcance) || 0), 0);
    const taxaEngajamento = somaAlcancePosts > 0 ? ((somaEngajamento / somaAlcancePosts) * 100).toFixed(1) : null;

    container.innerHTML = [
      cartaoNumero(seguidoresAtuais, "Seguidores atuais", null, true),
      cartaoNumero(seguidoresGanhos, "Seguidores ganhos no período"),
      // O Instagram não disponibiliza "seguidores perdidos" separado do ganho líquido pela API oficial
      `<div class="cartao-numero"><div class="cartao-numero-numero">—</div><div class="cartao-numero-rotulo">Seguidores perdidos</div><div class="ig-metrica-delta">não disponível pela API do Instagram</div></div>`,
      cartaoNumero(alcance, "Alcance no período", alcance - alcanceAnterior),
      cartaoNumero(impressoes, "Impressões no período", impressoes - impressoesAnterior),
      cartaoNumero(visitasPerfil, "Visitas ao perfil"),
      cartaoNumero(cliquesLink, "Cliques no link da bio"),
      cartaoNumero(postsNoPeriodo.length, "Publicações no período"),
      cartaoNumero(totalReels, "Reels no período"),
      cartaoNumero(taxaEngajamento !== null ? `${taxaEngajamento}%` : null, "Taxa de engajamento"),
    ].join("");
  }

  function renderizarGraficoSeguidores() {
    const container = document.getElementById("igGraficoSeguidores");
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

  function engajamentoDoPost(p) {
    return (Number(p.curtidas) || 0) + (Number(p.comentarios) || 0) + (Number(p.salvamentos) || 0) + (Number(p.compartilhamentos) || 0);
  }

  function renderizarInsights() {
    const container = document.getElementById("igInsights");
    if (!container) return;

    const { inicio, fim } = obterIntervaloPeriodo();
    const posts = cachePosts.filter((p) => p.publicado_em && dentroDoPeriodo(p.publicado_em, inicio, fim));

    if (posts.length < 3) {
      container.innerHTML = `<p class="estado-vazio">Ainda não há publicações suficientes neste período para gerar insights. Sincronize novamente depois de publicar mais conteúdo.</p>`;
      return;
    }

    const itens = [];

    const porAlcance = [...posts].sort((a, b) => (Number(b.alcance) || 0) - (Number(a.alcance) || 0))[0];
    if (porAlcance && porAlcance.alcance) {
      itens.push(`Seu conteúdo com maior alcance foi <strong>"${escapeHtml(resumirLegenda(porAlcance.legenda, 60))}"</strong>, com ${formatarNumero(porAlcance.alcance)} contas alcançadas.`);
    }

    const porEngajamento = [...posts].sort((a, b) => engajamentoDoPost(b) - engajamentoDoPost(a))[0];
    if (porEngajamento) {
      itens.push(`Seu conteúdo com maior engajamento foi <strong>"${escapeHtml(resumirLegenda(porEngajamento.legenda, 60))}"</strong>, com ${formatarNumero(engajamentoDoPost(porEngajamento))} interações.`);
    }

    // Melhor formato
    const grupos = {};
    posts.forEach((p) => {
      const chave = p.is_reel ? "Reels" : p.tipo === "CAROUSEL_ALBUM" ? "Carrosséis" : "Fotos";
      (grupos[chave] = grupos[chave] || []).push(p);
    });
    const mediaEngajamentoPorGrupo = Object.entries(grupos).map(([nome, lista]) => ({
      nome,
      media: lista.reduce((s, p) => s + engajamentoDoPost(p), 0) / lista.length,
    }));
    if (mediaEngajamentoPorGrupo.length > 1) {
      const melhorFormato = mediaEngajamentoPorGrupo.sort((a, b) => b.media - a.media)[0];
      itens.push(`O formato que mais performou foi <strong>${melhorFormato.nome}</strong>, com média de ${formatarNumero(Math.round(melhorFormato.media))} interações por publicação.`);
    }

    // Melhor dia da semana
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

    // Melhor horário
    const porHora = {};
    posts.forEach((p) => {
      const hora = new Date(p.publicado_em).getHours();
      (porHora[hora] = porHora[hora] || []).push(p);
    });
    const mediaPorHora = Object.entries(porHora).map(([hora, lista]) => ({
      hora: Number(hora),
      media: lista.reduce((s, p) => s + engajamentoDoPost(p), 0) / lista.length,
    }));
    if (mediaPorHora.length > 1) {
      const melhorHora = mediaPorHora.sort((a, b) => b.media - a.media)[0];
      itens.push(`Suas publicações às <strong>${String(melhorHora.hora).padStart(2, "0")}h</strong> tendem a performar melhor que nos outros horários.`);
    }

    itens.push(`Você publicou <strong>${posts.length}</strong> vezes no período selecionado.`);

    container.innerHTML = itens.map((texto) => `<div class="ig-insight-item">${texto}</div>`).join("");
  }

  // ==========================================================================
  // RENDERIZAÇÃO — RANKING (Top 10)
  // ==========================================================================
  function renderizarRanking() {
    const container = document.getElementById("igRanking");
    if (!container) return;

    const { inicio, fim } = obterIntervaloPeriodo();
    const posts = cachePosts.filter((p) => p.publicado_em && dentroDoPeriodo(p.publicado_em, inicio, fim));

    const valorDoRanking = {
      alcance: (p) => Number(p.alcance) || 0,
      engajamento: (p) => engajamentoDoPost(p),
      compartilhamentos: (p) => Number(p.compartilhamentos) || 0,
      salvamentos: (p) => Number(p.salvamentos) || 0,
    }[rankingAtual];

    const ordenado = [...posts].sort((a, b) => valorDoRanking(b) - valorDoRanking(a)).slice(0, 10);

    if (!ordenado.length) {
      container.innerHTML = `<p class="estado-vazio">Nenhuma publicação com dados suficientes neste período.</p>`;
      return;
    }

    const maximo = Math.max(1, valorDoRanking(ordenado[0]));

    container.innerHTML = ordenado
      .map((p) => {
        const largura = Math.round((valorDoRanking(p) / maximo) * 100);
        return `
          <div class="item-barra-horizontal" data-id="${p.id}">
            <div class="item-barra-cabecalho">
              <span>${escapeHtml(resumirLegenda(p.legenda, 50))}</span>
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
  function rotuloTipo(post) {
    if (post.is_reel) return "Reel";
    if (post.tipo === "CAROUSEL_ALBUM") return "Carrossel";
    if (post.tipo === "VIDEO") return "Vídeo";
    return "Foto";
  }

  function renderizarPosts() {
    const container = document.getElementById("igPosts");
    if (!container) return;

    const { inicio, fim } = obterIntervaloPeriodo();
    const posts = cachePosts.filter((p) => p.publicado_em && dentroDoPeriodo(p.publicado_em, inicio, fim));

    if (!posts.length) {
      container.innerHTML = `<p class="estado-vazio">Nenhuma publicação neste período.</p>`;
      return;
    }

    container.innerHTML = posts
      .map((p) => {
        const dataFormatada = p.publicado_em ? new Date(p.publicado_em).toLocaleDateString("pt-BR") : "";
        return `
          <div class="ig-post-card" data-id="${p.id}">
            <div class="ig-post-thumb" style="background-image:url('${escapeHtml(p.thumbnail_url || "")}')">
              <span class="ig-post-tipo">${rotuloTipo(p)}</span>
            </div>
            <div class="ig-post-info">
              <p class="ig-post-data">${dataFormatada}</p>
              <p class="ig-post-legenda">${escapeHtml(resumirLegenda(p.legenda, 90))}</p>
              <div class="ig-post-metricas">
                <span>❤ <strong>${formatarNumero(p.curtidas)}</strong></span>
                <span>💬 <strong>${formatarNumero(p.comentarios)}</strong></span>
                <span>↗ <strong>${formatarNumero(p.compartilhamentos)}</strong></span>
                <span>🔖 <strong>${formatarNumero(p.salvamentos)}</strong></span>
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

    document.getElementById("igModalConteudo").innerHTML = `
      <div class="ig-post-thumb" style="background-image:url('${escapeHtml(post.thumbnail_url || "")}'); aspect-ratio: 4/5; border-radius: 16px; margin-bottom: 18px;">
        <span class="ig-post-tipo">${rotuloTipo(post)}</span>
      </div>
      <p class="ig-post-data">${dataFormatada}</p>
      <p style="font-size:14px; line-height:1.6; margin: 8px 0 18px;">${escapeHtml(post.legenda || "(sem legenda)")}</p>
      <div class="grade-numeros" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 0;">
        ${cartaoNumero(post.curtidas, "Curtidas")}
        ${cartaoNumero(post.comentarios, "Comentários")}
        ${cartaoNumero(post.compartilhamentos, "Compartilhamentos")}
        ${cartaoNumero(post.salvamentos, "Salvamentos")}
        ${cartaoNumero(post.alcance, "Alcance")}
        ${cartaoNumero(post.impressoes, "Impressões")}
        ${post.is_reel ? cartaoNumero(post.plays, "Reproduções") : ""}
      </div>
      ${post.permalink ? `<p style="margin-top:18px;"><a href="${escapeHtml(post.permalink)}" target="_blank" rel="noopener" class="botao-acao">Ver no Instagram</a></p>` : ""}
    `;
    document.getElementById("igModalPost").classList.add("ativo");
  }

  function fecharDetalhePost() {
    document.getElementById("igModalPost").classList.remove("ativo");
  }

  // ==========================================================================
  // RENDERIZAÇÃO GERAL
  // ==========================================================================
  function renderizarTudo() {
    const ultimaSync = document.getElementById("igUltimaSincronizacao");
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
    document.getElementById("formConexaoInstagram").addEventListener("submit", async (e) => {
      e.preventDefault();
      const igUserId = document.getElementById("igUserId").value.trim();
      const igToken = document.getElementById("igToken").value.trim();
      if (!igUserId || !igToken) return;

      const botao = e.target.querySelector("button[type=submit]");
      botao.disabled = true;
      botao.textContent = "Conectando...";

      try {
        await salvarConfig(igUserId, igToken);
        config = { ig_user_id: igUserId, access_token: igToken };
        document.getElementById("igConexao").classList.add("oculto");
        document.getElementById("igConteudo").classList.remove("oculto");
        await sincronizar();
      } catch (erro) {
        console.error(erro);
        mostrarErro("Não foi possível salvar a conexão. Confira o ID da conta e o token e tente novamente.");
      } finally {
        botao.disabled = false;
        botao.textContent = "Conectar";
      }
    });

    document.getElementById("botaoSincronizarInstagram").addEventListener("click", sincronizar);

    document.querySelectorAll('[data-ig-periodo]').forEach((botao) => {
      botao.addEventListener("click", () => {
        document.querySelectorAll('[data-ig-periodo]').forEach((b) => b.classList.remove("ativo"));
        botao.classList.add("ativo");
        periodoAtual = botao.dataset.igPeriodo;
        document.getElementById("igPeriodoPersonalizado").classList.toggle("oculto", periodoAtual !== "personalizado");
        if (periodoAtual !== "personalizado") renderizarTudo();
      });
    });

    document.getElementById("igAplicarPersonalizado").addEventListener("click", () => {
      const inicio = document.getElementById("igDataInicio").value;
      const fim = document.getElementById("igDataFim").value;
      if (!inicio || !fim) return;
      periodoPersonalizadoInicio = new Date(inicio);
      periodoPersonalizadoFim = new Date(fim);
      renderizarTudo();
    });

    document.querySelectorAll('[data-ranking]').forEach((botao) => {
      botao.addEventListener("click", () => {
        document.querySelectorAll('[data-ranking]').forEach((b) => b.classList.remove("ativo"));
        botao.classList.add("ativo");
        rankingAtual = botao.dataset.ranking;
        renderizarRanking();
      });
    });

    document.getElementById("igModalFechar").addEventListener("click", fecharDetalhePost);
    document.getElementById("igModalPost").addEventListener("click", (e) => {
      if (e.target.id === "igModalPost") fecharDetalhePost();
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
      mostrarErro("Não foi possível verificar a conexão com o Instagram.");
      return;
    }

    if (!config) {
      document.getElementById("igConexao").classList.remove("oculto");
      document.getElementById("igConteudo").classList.add("oculto");
      return;
    }

    document.getElementById("igConexao").classList.add("oculto");
    document.getElementById("igConteudo").classList.remove("oculto");

    try {
      await carregarCacheLocal();
      renderizarTudo();
    } catch (erro) {
      console.error(erro);
      mostrarErro("Não foi possível carregar os dados salvos do Instagram.");
    }
  }

  window.InstagramIntelligence = { iniciar };
})();
