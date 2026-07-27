// ============================================================================
// FINANCEIRO — interface da aba (KPIs, filtros, tabela, modal, toast).
// Usa window.Financeiro (js/financeiro.js) para ler/gravar no Supabase.
// Reaproveita utilidades já globais do painel: escapeHtml, chaveDia, MESES_PT
// (definidas no <script> principal de painel/index.html).
// ============================================================================
(function () {
  let cache = [];
  let mesAtual = new Date().getMonth();
  let anoAtual = new Date().getFullYear();
  let tipoFiltro = "todas"; // "todas" | "receita" | "despesa"
  let valoresOcultos = false;
  let jaIniciado = false;
  let timeoutToast = null;

  // --------------------------------------------------------------------------
  // Utilidades
  // --------------------------------------------------------------------------
  function formatarMoeda(valor) {
    return (Number(valor) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatarDataCurta(dataStr) {
    const [, mes, dia] = dataStr.split("-");
    return `${dia}/${mes}`;
  }

  function parseDataLocal(dataStr) {
    const [ano, mes, dia] = dataStr.split("-").map(Number);
    return new Date(ano, mes - 1, dia);
  }

  function obterTransacoesDoMes() {
    return cache.filter((t) => {
      const d = parseDataLocal(t.date);
      return d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
    });
  }

  // --------------------------------------------------------------------------
  // Seletores de mês/ano
  // --------------------------------------------------------------------------
  function popularSeletores() {
    const selMes = document.getElementById("finMes");
    const selAno = document.getElementById("finAno");

    selMes.innerHTML = MESES_PT.map((nome, i) => `<option value="${i}">${nome}</option>`).join("");
    selMes.value = String(mesAtual);

    const anoBase = new Date().getFullYear();
    const anos = [];
    for (let a = anoBase - 3; a <= anoBase + 1; a++) anos.push(a);
    selAno.innerHTML = anos.map((a) => `<option value="${a}">${a}</option>`).join("");
    selAno.value = String(anoAtual);
  }

  // --------------------------------------------------------------------------
  // Renderização
  // --------------------------------------------------------------------------
  function renderizarTudo() {
    renderizarKpis();
    renderizarLista();
  }

  function renderizarKpis() {
    const doMes = obterTransacoesDoMes();
    const ganhos = doMes.filter((t) => t.type === "receita").reduce((s, t) => s + Number(t.value), 0);
    const despesas = doMes.filter((t) => t.type === "despesa").reduce((s, t) => s + Number(t.value), 0);
    const saldo = ganhos - despesas;

    document.getElementById("finGanhos").textContent = valoresOcultos ? "••••" : formatarMoeda(ganhos);
    document.getElementById("finDespesas").textContent = valoresOcultos ? "••••" : formatarMoeda(despesas);

    const elSaldo = document.getElementById("finSaldo");
    elSaldo.textContent = valoresOcultos ? "••••" : formatarMoeda(saldo);
    elSaldo.classList.toggle("positivo", saldo >= 0);
    elSaldo.classList.toggle("negativo", saldo < 0);
  }

  function renderizarLista() {
    const container = document.getElementById("finLista");
    const doMes = obterTransacoesDoMes();
    const filtradas = (tipoFiltro === "todas" ? doMes : doMes.filter((t) => t.type === tipoFiltro)).sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0
    );

    if (!filtradas.length) {
      container.innerHTML = `
        <div class="fin-estado-vazio">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>
          <p>Nenhuma transação. Registre suas receitas e despesas para acompanhar suas finanças.</p>
          <button type="button" class="botao-salvar-tarefa" id="finBotaoVazio">+ Nova transação</button>
        </div>`;
      document.getElementById("finBotaoVazio").addEventListener("click", () => abrirModal());
      return;
    }

    container.innerHTML = filtradas
      .map((t) => {
        const sinal = t.type === "receita" ? "+" : "-";
        const valorTexto = valoresOcultos ? "••••" : `${sinal} ${formatarMoeda(t.value)}`;
        const titulo = t.description && t.description.trim() ? t.description : t.fonte;
        return `
          <div class="fin-transacao" data-id="${t.id}">
            <div class="fin-transacao-data">${formatarDataCurta(t.date)}</div>
            <div class="fin-transacao-info">
              <p class="fin-transacao-titulo">${escapeHtml(titulo)}</p>
              ${t.cliente ? `<p class="fin-transacao-cliente">${escapeHtml(t.cliente)}</p>` : ""}
            </div>
            <span class="fin-transacao-badge ${t.type}">${t.type === "receita" ? "Receita" : "Despesa"}</span>
            <div class="fin-transacao-valor ${t.type}">${valorTexto}</div>
            <div class="fin-transacao-acoes">
              <button type="button" class="fin-transacao-acao" data-acao="editar" data-id="${t.id}" aria-label="Editar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
              <button type="button" class="fin-transacao-acao excluir" data-acao="excluir" data-id="${t.id}" aria-label="Excluir">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              </button>
            </div>
          </div>`;
      })
      .join("");

    container.querySelectorAll('[data-acao="editar"]').forEach((botao) => {
      botao.addEventListener("click", () => abrirModal(cache.find((t) => t.id === botao.dataset.id)));
    });
    container.querySelectorAll('[data-acao="excluir"]').forEach((botao) => {
      botao.addEventListener("click", () => confirmarExclusao(botao.dataset.id));
    });
  }

  // --------------------------------------------------------------------------
  // Modal de nova/editar transação
  // --------------------------------------------------------------------------
  function selecionarTipo(tipo) {
    document.getElementById("finBotaoTipoReceita").classList.toggle("ativo", tipo === "receita");
    document.getElementById("finBotaoTipoDespesa").classList.toggle("ativo", tipo === "despesa");
    document.getElementById("finRotuloFonte").textContent = tipo === "receita" ? "Fonte" : "Categoria";
    document.getElementById("finCampoFonte").placeholder =
      tipo === "receita" ? "ex.: UGC, Hotmart" : "ex.: Marketing, Equipamento";
    document.getElementById("finCampoClienteWrap").style.display = tipo === "receita" ? "flex" : "none";
  }

  function tipoSelecionado() {
    return document.getElementById("finBotaoTipoReceita").classList.contains("ativo") ? "receita" : "despesa";
  }

  function abrirModal(transacao) {
    const form = document.getElementById("finForm");
    form.reset();
    document.getElementById("finCampoId").value = transacao ? transacao.id : "";
    document.getElementById("finModalTitulo").textContent = transacao ? "Editar transação" : "Nova transação";

    selecionarTipo(transacao ? transacao.type : "receita");

    if (transacao) {
      document.getElementById("finCampoValor").value = transacao.value;
      document.getElementById("finCampoFonte").value = transacao.fonte;
      document.getElementById("finCampoDescricao").value = transacao.description || "";
      document.getElementById("finCampoData").value = transacao.date;
      document.getElementById("finCampoCliente").value = transacao.cliente || "";
    } else {
      document.getElementById("finCampoData").value = chaveDia(new Date());
    }

    document.getElementById("finModalOverlay").classList.add("ativo");
  }

  function fecharModal() {
    document.getElementById("finModalOverlay").classList.remove("ativo");
  }

  async function salvarTransacao(e) {
    e.preventDefault();
    const id = document.getElementById("finCampoId").value;
    const tipo = tipoSelecionado();
    const valor = parseFloat(document.getElementById("finCampoValor").value);

    if (!valor || valor <= 0) {
      mostrarToast("Informe um valor válido.");
      return;
    }

    const dados = {
      type: tipo,
      value: valor,
      fonte: document.getElementById("finCampoFonte").value.trim(),
      description: document.getElementById("finCampoDescricao").value.trim() || null,
      date: document.getElementById("finCampoData").value,
      cliente: tipo === "receita" ? document.getElementById("finCampoCliente").value.trim() || null : null,
    };

    try {
      if (id) {
        await window.Financeiro.atualizar(id, dados);
        mostrarToast("Transação atualizada.");
      } else {
        await window.Financeiro.adicionar(dados);
        mostrarToast(tipo === "receita" ? "Receita adicionada." : "Despesa adicionada.");
      }
      cache = window.Financeiro.obterCache();
      fecharModal();
      renderizarTudo();
    } catch (erro) {
      console.error(erro);
      mostrarToast("Não foi possível salvar. Tente novamente.");
    }
  }

  // --------------------------------------------------------------------------
  // Excluir com confirmação + desfazer
  // --------------------------------------------------------------------------
  async function confirmarExclusao(id) {
    const transacao = cache.find((t) => t.id === id);
    if (!transacao) return;
    if (!window.confirm("Excluir esta transação?")) return;

    try {
      await window.Financeiro.excluir(id);
      cache = window.Financeiro.obterCache();
      renderizarTudo();
      mostrarToast("Transação excluída.", transacao);
    } catch (erro) {
      console.error(erro);
      mostrarToast("Não foi possível excluir. Tente novamente.");
    }
  }

  // --------------------------------------------------------------------------
  // Toast (aviso temporário, com opção de desfazer exclusão)
  // --------------------------------------------------------------------------
  function mostrarToast(texto, transacaoParaDesfazer) {
    const toast = document.getElementById("finToast");
    const botaoDesfazer = document.getElementById("finToastDesfazer");
    document.getElementById("finToastTexto").textContent = texto;

    botaoDesfazer.classList.toggle("oculto", !transacaoParaDesfazer);
    botaoDesfazer.onclick = transacaoParaDesfazer
      ? async () => {
          try {
            const { id, created_at, updated_at, ...dados } = transacaoParaDesfazer;
            await window.Financeiro.adicionar(dados);
            cache = window.Financeiro.obterCache();
            renderizarTudo();
            esconderToast();
          } catch (erro) {
            console.error(erro);
          }
        }
      : null;

    toast.classList.add("visivel");
    clearTimeout(timeoutToast);
    timeoutToast = setTimeout(esconderToast, 5000);
  }

  function esconderToast() {
    document.getElementById("finToast").classList.remove("visivel");
  }

  // --------------------------------------------------------------------------
  // Mostrar/esconder valores
  // --------------------------------------------------------------------------
  function alternarValoresOcultos() {
    valoresOcultos = !valoresOcultos;
    sessionStorage.setItem("fin_valores_ocultos", valoresOcultos ? "1" : "0");
    document.getElementById("finBotaoOlho").classList.toggle("ativo", valoresOcultos);
    renderizarTudo();
  }

  // --------------------------------------------------------------------------
  // Eventos (ligados uma única vez)
  // --------------------------------------------------------------------------
  function ligarEventos() {
    document.getElementById("finBotaoOlho").addEventListener("click", alternarValoresOcultos);

    document.getElementById("finMes").addEventListener("change", (e) => {
      mesAtual = Number(e.target.value);
      renderizarTudo();
    });
    document.getElementById("finAno").addEventListener("change", (e) => {
      anoAtual = Number(e.target.value);
      renderizarTudo();
    });

    document.querySelectorAll("[data-fin-tipo]").forEach((botao) => {
      botao.addEventListener("click", () => {
        document.querySelectorAll("[data-fin-tipo]").forEach((b) => b.classList.remove("ativo"));
        botao.classList.add("ativo");
        tipoFiltro = botao.dataset.finTipo;
        renderizarLista();
      });
    });

    document.getElementById("finBotaoNova").addEventListener("click", () => abrirModal());
    document.getElementById("finBotaoNovaFab").addEventListener("click", () => abrirModal());
    document.getElementById("finModalFechar").addEventListener("click", fecharModal);
    document.getElementById("finModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "finModalOverlay") fecharModal();
    });

    document.getElementById("finBotaoTipoReceita").addEventListener("click", () => selecionarTipo("receita"));
    document.getElementById("finBotaoTipoDespesa").addEventListener("click", () => selecionarTipo("despesa"));

    document.getElementById("finForm").addEventListener("submit", salvarTransacao);
  }

  // --------------------------------------------------------------------------
  // Inicialização — chamada pelo painel na primeira vez que a aba abre
  // --------------------------------------------------------------------------
  async function iniciar() {
    if (jaIniciado) return;
    jaIniciado = true;

    valoresOcultos = sessionStorage.getItem("fin_valores_ocultos") === "1";
    document.getElementById("finBotaoOlho").classList.toggle("ativo", valoresOcultos);

    popularSeletores();
    ligarEventos();

    try {
      cache = await window.Financeiro.carregar();
      renderizarTudo();
    } catch (erro) {
      console.error(erro);
      mostrarToast("Não foi possível carregar suas transações.");
    }
  }

  window.FinanceiroUI = { iniciar };
})();
