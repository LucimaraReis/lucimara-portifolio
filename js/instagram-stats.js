// ============================================================================
// NÚMEROS DO INSTAGRAM NA SEÇÃO "RESULTADOS" DO SITE PÚBLICO
// Busca os dados mais recentes já sincronizados no painel administrativo
// (tabelas instagram_snapshots / instagram_posts). Só LEITURA, com a chave
// pública. Se ainda não houver dados sincronizados, os números fixos que já
// estão no HTML continuam aparecendo normalmente — nada quebra.
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

  document.addEventListener("DOMContentLoaded", async () => {
    const statSeguidores = document.getElementById("statSeguidores");
    const statAlcance = document.getElementById("statAlcance");
    const statCompartilhamentos = document.getElementById("statCompartilhamentos");
    const statInteracoes = document.getElementById("statInteracoes");
    if (!statSeguidores) return; // esta página não tem a seção de resultados

    try {
      const sbStats = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

      const [{ data: snapshots }, { data: posts }] = await Promise.all([
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
      ]);

      if (snapshots && snapshots.length) {
        statSeguidores.textContent = formatarMil(snapshots[0].seguidores);
        const alcance30d = snapshots.reduce((soma, s) => soma + (Number(s.alcance) || 0), 0);
        statAlcance.textContent = formatarMil(alcance30d);
      }

      if (posts && posts.length) {
        const maiorCompartilhamento = Math.max(...posts.map((p) => Number(p.compartilhamentos) || 0));
        const maiorInteracao = Math.max(
          ...posts.map(
            (p) =>
              (Number(p.curtidas) || 0) +
              (Number(p.comentarios) || 0) +
              (Number(p.salvamentos) || 0) +
              (Number(p.compartilhamentos) || 0)
          )
        );
        statCompartilhamentos.textContent = formatarMil(maiorCompartilhamento);
        statInteracoes.textContent = formatarMil(maiorInteracao);
      }
    } catch (erro) {
      console.warn("Não foi possível atualizar os números do Instagram:", erro.message);
      // Mantém os números fixos do HTML como estão — nunca quebra a tela.
    }
  });
})();
