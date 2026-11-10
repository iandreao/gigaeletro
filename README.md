# Gigaeletro

Catálogo e orçamento on-line da Gigaeletro (Venda Nova do Imigrante, ES): o cliente monta a lista pelo catálogo tradicional ou pelo GigaVoz e envia o orçamento em PDF pelo WhatsApp. O gestor acompanha os orçamentos e o painel comercial em `/admin.html`.

Front-end em HTML, CSS e JavaScript nativos; back-end em Python (`servidor.py`), publicado como funções serverless na Vercel (`api/*.py`).

## Ambiente de Produção

| | |
| --- | --- |
| Site oficial | https://gigaeletro.com.br |
| Área do gestor | https://gigaeletro.com.br/admin.html |
| Link de orçamento enviado ao cliente | `https://gigaeletro.com.br/api/ver-pdf?id=<id>` |
| Repositório | https://github.com/iandreao/gigaeletro (branch `main`) |
| Região das funções | `gru1` (São Paulo) |

O endereço antigo `https://gigaeletro.vercel.app` responde com redirecionamento 301 para o domínio oficial (regra em `vercel.json`). As rotas `/api/*` do endereço antigo continuam atendendo sem redirecionar, para que links de orçamento já enviados por WhatsApp e páginas antigas em cache não quebrem. `https://www.gigaeletro.com.br` também redireciona (301) para o domínio sem `www`.

HTTP puro é convertido para HTTPS pela própria Vercel em todos os domínios do projeto, antes de qualquer regra do `vercel.json`.

## Domínio (Vercel + Registro.br)

1. Na Vercel: **Project → Settings → Domains**, adicionar `gigaeletro.com.br` (domínio principal) e `www.gigaeletro.com.br`.
2. No Registro.br, na zona DNS de `gigaeletro.com.br`:
   - registro `A` no domínio raiz apontando para o IP indicado pela Vercel (atualmente `76.76.21.21`);
   - registro `CNAME` em `www` apontando para `cname.vercel-dns.com`.
3. Aguardar a Vercel marcar os dois domínios como **Valid Configuration** (o certificado HTTPS é emitido automaticamente).
4. Conferir:

   ```powershell
   Resolve-DnsName gigaeletro.com.br -Server 8.8.8.8
   Invoke-WebRequest -UseBasicParsing https://gigaeletro.com.br/ | Select-Object StatusCode
   ```

Só publique alterações que dependem do domínio novo depois desses passos: o link de PDF enviado ao cliente usa `https://gigaeletro.com.br` (`SITE_PDF` em `js/orcamento.js`).

## Variáveis de ambiente (Vercel)

| Variável | Uso |
| --- | --- |
| `ADMIN_PASSWORD` | Senha da área do gestor. Sem ela o login fica fechado em produção. |
| `SEGREDO_SESSAO` | Assina o cookie de sessão do gestor. |
| `BLOB_READ_WRITE_TOKEN` | Acesso ao Vercel Blob (painel de orçamentos, métricas e PDFs). |
| `REDIS_URL` | Redis (Redis Cloud pela Vercel) para a telemetria de acessos, no formato `redis://` ou `rediss://`. Sem ela o site funciona, mas não conta acessos em produção. Localmente os acessos vão para a tabela SQLite `acessos_log`. |
| `RESEND_API_KEY` | Chave do Resend usada por `POST /api/enviar-orcamento-email` (botão "Enviar por E-mail"). Sem ela o botão responde que o envio está indisponível. |
| `EMAIL_ADMIN_COPIA` | E-mail(s) da loja que recebem cópia oculta (Bcc) de cada orçamento enviado; vários separados por vírgula. O primeiro também vira o endereço de resposta. |
| `EMAIL_REMETENTE` | Opcional. Remetente do e-mail; padrão `Gigaeletro <orcamentos@gigaeletro.com.br>`. Precisa ser de um domínio verificado no Resend. Para testes sem domínio, use `Gigaeletro <onboarding@resend.dev>`, que só entrega no e-mail dono da conta. |

Nunca versionar valores dessas variáveis; arquivos `.env*` estão no `.gitignore`.

## Rodar localmente

```powershell
python servidor.py
```

Abre em http://127.0.0.1:8765/. Fora da Vercel os dados ficam em `data/` e o login usa valores de teste locais.

## Deploy

O projeto está ligado à Vercel pela integração com o GitHub: não há GitHub Actions.

- **Produção:** todo push na branch `main` gera o deploy de produção automaticamente.

  ```powershell
  git add <arquivos>
  git commit -m "Mensagem"
  git push origin main
  ```

- **Preview:** pushes em outras branches geram uma URL de preview (`*.vercel.app`), que não é redirecionada para o domínio oficial.

- **Vercel CLI (opcional):**

  ```powershell
  npm i -g vercel
  vercel login
  vercel link        # uma vez, vincula a pasta ao projeto
  vercel             # deploy de preview
  vercel --prod      # deploy de produção
  ```

Ao alterar arquivos CSS ou JS, atualize o parâmetro de versão (`?v=`) correspondente em `index.html` ou `admin.html` para evitar cache antigo no navegador.
