# Portfólio + Painel Administrativo

Este repositório contém o site do portfólio (`index.html`) e o painel
administrativo protegido por login (`/login` e `/painel`), feito em HTML,
CSS e JavaScript puro, sem framework e sem build.

## Estrutura

```
index.html          → site público do portfólio
login/index.html     → tela de login (fica em /login)
painel/index.html    → painel interno protegido (fica em /painel)
js/auth.js            → autenticação compartilhada (Supabase)
setup.sql             → SQL para rodar no Supabase
CNAME                 → já configurado com lucimarareis.com
.nojekyll              → evita que o GitHub processe o site como Jekyll
Fotos do portifolio/   → fotos/vídeos usados no site (sobe para o GitHub)
Fotos Lucimara/        → arquivo bruto, NÃO deve ir para o GitHub
```

## Passo a passo para publicar em lucimarareis.com com GitHub Pages

### 1. Rode o `setup.sql` no Supabase
No painel do seu projeto em [supabase.com](https://supabase.com) → **SQL
Editor** → **New query**, cole todo o conteúdo de `setup.sql` e clique em
**Run**. Isso cria as tabelas `portfolio_events` e `portfolio_leads` já com
a segurança (RLS) configurada.

### 2. Crie seu usuário de login
No Supabase, vá em **Authentication → Users → Add user**, informe seu
e-mail e uma senha. Esse é o login que você vai usar em `/login`.

### 3. Crie o repositório no GitHub e suba os arquivos
Como seu computador não tem o `git` instalado, faça pelo site do GitHub:
1. Em [github.com](https://github.com), clique em **New repository**, dê um
   nome (ex.: `lucimara-portfolio`) e crie como **público**.
2. Abra o repositório criado, clique em **Add file → Upload files**.
3. Arraste para lá TUDO da pasta `UGC LARA DAM`, **exceto a pasta "Fotos
   Lucimara"** (ela é o arquivo bruto, pesada demais e não deve subir).
   Inclua: `index.html`, `CNAME`, `.nojekyll`, `setup.sql`, `README.md`, e
   as pastas `js`, `login`, `painel` e `Fotos do portifolio`.
4. Role até o final da página e clique em **Commit changes**.

> Observação: arquivos que começam com ponto (como `.nojekyll`) às vezes
> não aparecem ao arrastar pastas em alguns navegadores. Se isso acontecer,
> clique em **Add file → Create new file**, digite `.nojekyll` como nome e
> salve vazio, direto pelo site do GitHub.

### 4. Ative o GitHub Pages
No repositório, vá em **Settings → Pages**. Em "Build and deployment",
escolha **Deploy from a branch**, selecione a branch `main` e a pasta
`/ (root)`, depois clique em **Save**.

Ainda em Settings → Pages, no campo **Custom domain**, digite
`lucimarareis.com` e salve (o arquivo `CNAME` que já subiu faz esse valor
aparecer sozinho, mas confirme que o campo está preenchido). Aguarde a
checagem de DNS ficar verde antes de marcar **Enforce HTTPS** (esse
checkbox só habilita depois que o domínio for validado).

### 5. Aponte o DNS do seu domínio para o GitHub
No painel onde você registrou `lucimarareis.com` (Registro.br, GoDaddy,
Hostinger etc.), na área de gerenciamento de DNS, crie estes registros:

**Para o domínio raiz (lucimarareis.com) funcionar, crie 4 registros A:**
```
Tipo  Nome/Host   Valor
A     @           185.199.108.153
A     @           185.199.109.153
A     @           185.199.110.153
A     @           185.199.111.153
```

**Se você também quiser que `www.lucimarareis.com` funcione**, crie um
registro CNAME (troque `SEU-USUARIO` pelo seu usuário do GitHub):
```
Tipo   Nome/Host   Valor
CNAME  www         SEU-USUARIO.github.io
```

A propagação do DNS pode levar de alguns minutos até algumas horas. O
certificado HTTPS do GitHub Pages é emitido automaticamente depois que o
DNS estiver propagado — não precisa fazer nada além de esperar e depois
marcar **Enforce HTTPS** em Settings → Pages.

### 6. Teste tudo
Depois que o domínio propagar, acesse:
- `https://lucimarareis.com` → site do portfólio
- `https://lucimarareis.com/login` → tela de login
- Faça login com o usuário criado no passo 2 e confirme que
  `https://lucimarareis.com/painel` mostra os números.

## Testar localmente antes de publicar (opcional)

Como os arquivos usam `fetch` para o Supabase, alguns navegadores bloqueiam
ao abrir o `.html` direto com duplo clique. Rode um servidor local simples
dentro da pasta `UGC LARA DAM`, por exemplo com Python já instalado:
```
python -m http.server 8000
```
Depois abra `http://localhost:8000/login/`. Se preferir, a extensão "Live
Server" do VS Code também funciona.

## Resumo em 3 linhas

1. **Testar localmente**: rode um servidor estático na pasta e abra
   `/login/` pelo navegador (nunca com duplo clique direto no arquivo).
2. **Criar seu login**: no Supabase, rode `setup.sql` e depois vá em
   Authentication → Users → Add user.
3. **Publicar**: suba os arquivos (menos "Fotos Lucimara") para um
   repositório no GitHub, ative o GitHub Pages com domínio
   `lucimarareis.com`, e aponte os registros A do seu DNS para o GitHub.
