// ============================================================================
// FINANCEIRO — camada de dados (receitas e despesas).
// Usa o mesmo cliente Supabase autenticado (sb) já criado em auth.js. Cada
// usuário só vê e mexe nas próprias transações — a tabela tem RLS garantindo
// isso no banco, mas aqui também filtramos por user_id nas leituras.
// ============================================================================
(function () {
  let cache = [];

  function ordenarCache() {
    cache.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }

  async function obterUsuarioAtual() {
    const { data } = await sb.auth.getSession();
    return data?.session?.user || null;
  }

  // Busca todas as transações do usuário logado, mais recentes primeiro.
  async function carregar() {
    const usuario = await obterUsuarioAtual();
    if (!usuario) {
      cache = [];
      return cache;
    }

    const { data, error } = await sb
      .from("financeiro")
      .select("*")
      .eq("user_id", usuario.id)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;
    cache = data || [];
    return cache;
  }

  function obterCache() {
    return cache;
  }

  // Adiciona uma transação nova, injetando o user_id da sessão atual.
  async function adicionar(dados) {
    const usuario = await obterUsuarioAtual();
    if (!usuario) throw new Error("Sua sessão expirou. Faça login novamente.");

    const { data, error } = await sb
      .from("financeiro")
      .insert({ ...dados, user_id: usuario.id })
      .select()
      .single();

    if (error) throw error;
    cache.unshift(data);
    ordenarCache();
    return data;
  }

  // Atualiza uma transação existente (usada também para "desfazer exclusão",
  // recriando o registro com os mesmos dados quando necessário).
  async function atualizar(id, dados) {
    const { data, error } = await sb
      .from("financeiro")
      .update({ ...dados, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    const indice = cache.findIndex((t) => t.id === id);
    if (indice !== -1) cache[indice] = data;
    else cache.unshift(data);
    ordenarCache();
    return data;
  }

  async function excluir(id) {
    const { error } = await sb.from("financeiro").delete().eq("id", id);
    if (error) throw error;
    cache = cache.filter((t) => t.id !== id);
  }

  window.Financeiro = { carregar, obterCache, adicionar, atualizar, excluir };
})();
