// ============================================================================
// NÚMEROS DA SEÇÃO "RESULTADOS" DO SITE PÚBLICO
// Busca os dados mais recentes já sincronizados no painel administrativo
// (Instagram e, se conectado, TikTok). Só LEITURA, com a chave pública. Se
// ainda não houver dados sincronizados, os números fixos que já estão no
// HTML continuam aparecendo normalmente — nada quebra.
//
// COMO COMBINA INSTAGRAM + TIKTOK: quando as duas redes têm o dado, o número
// mostrado é a MÉDIA entre elas (não mostramos separado). Quando só o
// Instagram tem o dado (ex.: "alcance", que o TikTok não expõe pela API
// pública), mostramos só o valor do Instagram.
// ============================================================================
(function () {
  const SUPABASE_URL = "https://eeoevhxlykbbauqvvtbv.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlb2V2aHhseWtiYmF1cXZ2dGJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NjY4OTYsImV4cCI6MjA5OTU0Mjg5Nn0.UaLDHg5ItHxXVxGHKHQAAnjqtWK0RsAlltMiBsVDVE0";
  const PERFIL = "lucimarareis.ugc";

  function formatarMil(valor) {
    const numero = Number(valor) || 0;
    if (numero >= 1000) {
      return (numero / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil";
    }
    return numero.toLocaleString("pt-BR");
  }

  // Combina dois valores: se os dois existirem, faz a média; se só um
  // existir, usa esse; se nenhum existir, devolve null (mantém o valor fixo do HTML).
  function combinar(valorInstagram, valorTikTok) {
    const temIg = valorInstagram !== null && valorInstagram !== undefined;
    const temTt = valorTikTok !== null && valorTikTok !== undefined;
    if (temIg && temTt) return (Number(valorInstagram) + Number(valorTikTok)) / 2;
    if (temIg) return Number(valorInstagram);
    if (temTt) return Number(valorTikTok);
    return null;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const statSeguidores = document.getElementById("statSeguidores");
    const statAlcance = document.getElementById("statAlcance");
    const statCompartilhamentos = document.getElementById("statCompartilhamentos");
    const statInteracoes = document.getElementById("statInteracoes");
    if (!statSeguidores) return; // esta página não tem a seção de resultados

    try {
      const sbStats = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

      const [
        { data: snapshotsIg },
        { data: postsIg },
        { data: snapshotsTt },
        { data: postsTt },
      ] = await Promise.all([
        sbStats
          .from("instagram_snapshots")
          .select("seguidores,alcance,data")
          .eq("perfil", PERFIL)
          .order("data", { ascending: false })
          .limit(31),
        sbStats
          .from("instagram_posts")
          .select("curtidas,comentarios,salvamentos,compartilhamentos")
          .eq("perfil", PERFIL),
        sbStats
          .from("tiktok_snapshots")
          .select("seguidores,data")
          .eq("perfil", PERFIL)
          .order("data", { ascending: false })
          .limit(1),
        sbStats
          .from("tiktok_posts")
          .select("curtidas,comentarios,compartilhamentos")
          .eq("perfil", PERFIL),
      ]);

      // --- Seguidores: média entre as duas redes quando as duas estiverem conectadas ---
      const seguidoresIg = snapshotsIg && snapshotsIg.length ? snapshotsIg[0].seguidores : null;
      const seguidoresTt = snapshotsTt && snapshotsTt.length ? snapshotsTt[0].seguidores : null;
      const seguidoresCombinado = combinar(seguidoresIg, seguidoresTt);
      if (seguidoresCombinado !== null) statSeguidores.textContent = formatarMil(seguidoresCombinado);

      // --- Alcance: só o Instagram expõe esse dado pela API pública ---
      if (snapshotsIg && snapshotsIg.length) {
        const alcance30d = snapshotsIg.reduce((soma, s) => soma + (Number(s.alcance) || 0), 0);
        statAlcance.textContent = formatarMil(alcance30d);
      }

      // --- Compartilhamentos e interações: melhor vídeo de cada rede, depois média ---
      let melhorCompartilhamentoIg = null;
      let melhorInteracaoIg = null;
      if (postsIg && postsIg.length) {
        melhorCompartilhamentoIg = Math.max(...postsIg.map((p) => Number(p.compartilhamentos) || 0));
        melhorInteracaoIg = Math.max(
          ...postsIg.map(
            (p) =>
              (Number(p.curtidas) || 0) +
              (Number(p.comentarios) || 0) +
              (Number(p.salvamentos) || 0) +
              (Number(p.compartilhamentos) || 0)
          )
        );
      }

      let melhorCompartilhamentoTt = null;
      let melhorInteracaoTt = null;
      if (postsTt && postsTt.length) {
        melhorCompartilhamentoTt = Math.max(...postsTt.map((p) => Number(p.compartilhamentos) || 0));
        melhorInteracaoTt = Math.max(
          ...postsTt.map((p) => (Number(p.curtidas) || 0) + (Number(p.comentarios) || 0) + (Number(p.compartilhamentos) || 0))
        );
      }

      const compartilhamentosCombinado = combinar(melhorCompartilhamentoIg, melhorCompartilhamentoTt);
      if (compartilhamentosCombinado !== null) statCompartilhamentos.textContent = formatarMil(compartilhamentosCombinado);

      const interacoesCombinado = combinar(melhorInteracaoIg, melhorInteracaoTt);
      if (interacoesCombinado !== null) statInteracoes.textContent = formatarMil(interacoesCombinado);
    } catch (erro) {
      console.warn("Não foi possível atualizar os números da seção Resultados:", erro.message);
      // Mantém os números fixos do HTML como estão — nunca quebra a tela.
    }
  });
})();
