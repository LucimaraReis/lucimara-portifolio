// ============================================================================
// AUTENTICAÇÃO COMPARTILHADA — usada por /login e /painel
// ============================================================================
// Este arquivo cria o cliente Supabase UMA ÚNICA VEZ e expõe as funções de
// autenticação em window.Auth para serem usadas nas outras páginas.

// --- Dados do projeto Supabase -------------------------------------------
// URL derivada do "ref" contido na chave anon (o valor colado originalmente
// era apenas o site institucional supabase.com, não a URL do projeto).
const SUPABASE_URL = "https://eeoevhxlykbbauqvvtbv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlb2V2aHhseWtiYmF1cXZ2dGJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NjY4OTYsImV4cCI6MjA5OTU0Mjg5Nn0.UaLDHg5ItHxXVxGHKHQAAnjqtWK0RsAlltMiBsVDVE0";

// Cria o cliente Supabase uma única vez (o script do CDN expõe window.supabase)
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Funções de autenticação expostas globalmente -------------------------
window.Auth = {

  // Faz login com e-mail e senha
  async login(email, senha) {
    const { data, error } = await sb.auth.signInWithPassword({
      email: email,
      password: senha,
    });

    if (error) {
      if (error.message === "Invalid login credentials") {
        throw new Error("E-mail ou senha incorretos.");
      }
      throw new Error(error.message);
    }

    return data.user;
  },

  // Verifica se existe uma sessão ativa. Se não houver, redireciona para o
  // login. Deve ser chamada logo no início de páginas protegidas (guarda).
  async checkAuth() {
    const { data, error } = await sb.auth.getSession();

    if (error || !data.session) {
      window.location.href = "/login";
      return null;
    }

    return data.session.user;
  },

  // Encerra a sessão e volta para o login
  async logout() {
    await sb.auth.signOut();
    window.location.href = "/login";
  },

  // Envia e-mail de recuperação de senha
  async recuperarSenha(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email);
    if (error) {
      throw new Error(error.message);
    }
  },
};
