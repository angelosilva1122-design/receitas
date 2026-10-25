# Receitas

App minimalista para guardar receitas no iPhone, inspirada na Recipe Keeper.
É uma PWA: instala-se pelo Safari e guarda tudo localmente no telemóvel (IndexedDB), sem contas nem servidores.

## Instalar no iPhone
1. Abre o endereço do Netlify no **Safari**.
2. Toca em **Partilhar** → **Adicionar ao ecrã principal**.
3. Abre a app a partir do ícone.

## Roadmap
| Versão | Funcionalidade |
|---|---|
| v0.1.0 | Lista de receitas e criação (título, ingredientes, passos) |
| v0.2.0 | Ver detalhe, editar e apagar |
| v0.3.0 | Backup: exportar e importar |
| v0.4.0 | Tempos, porções e notas |
| v0.5.0 | Pratos e categorias, pesquisa e filtros |
| v0.6.0 | Favoritos e ordenação |
| v0.7.0 | Modo cozinhar |
| v0.8.0 | Ajuste de porções |
| v0.9.0 | Fotografias (incluídas no backup) |
| v1.0.0 | Polimento, modo escuro e offline garantido |

Versões `x.y.Z` são correções de bugs.

## Publicar uma nova versão
1. Atualizar `APP_VERSION` em `app.js` e `CACHE` em `sw.js`.
2. Registar as alterações em `CHANGELOG.md`.
3. Enviar para o GitHub e criar a release com a tag `vX.Y.Z`.
4. O Netlify publica automaticamente.

## Estrutura
- `index.html`, `styles.css`, `app.js` — a app
- `sw.js` — funcionamento offline e atualizações
- `manifest.webmanifest`, `icons/` — instalação no ecrã principal
- `netlify.toml` — configuração de publicação
