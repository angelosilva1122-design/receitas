# Changelog

## v0.5.0 — 2026-10-25
- Cada receita pode ter um prato (Entradas, Sopas, Prato Principal, Sobremesa, Bebidas) e várias categorias (carne, peixe, vegetariano, arroz, massa, batata, italiano, bolo)
- Pratos e categorias escolhem-se no formulário, com opção de criar novos na hora
- Novo ecrã "Organizar" para adicionar e remover pratos e categorias (junto com a cópia de segurança)
- Pesquisa por nome, ingrediente, prato ou categoria (ignora acentos e maiúsculas)
- Filtros na lista: um prato e uma ou mais categorias
- Backup inclui as listas de pratos e categorias

## v0.4.0 — 2026-10-25
- Novos campos opcionais: tempo de preparação, tempo de cozedura, porções e notas
- Detalhe mostra os tempos e as porções num resumo, e as notas no fim
- Lista mostra o tempo total quando existe
- Backup e importação incluem os novos campos

## v0.3.0 — 2026-10-25
- Novo botão de cópia de segurança no topo da lista
- Exportar todas as receitas para um ficheiro JSON (no iPhone abre a folha de partilha: Guardar em Ficheiros, AirDrop, Mail…)
- Importar receitas de um ficheiro de backup, juntando-as às atuais sem duplicar
- Indicação da data do último backup

## v0.2.0 — 2026-10-25
- Tocar numa receita abre o detalhe: ingredientes e passos numerados
- Editar receita (reaproveita o formulário, com aviso se houver alterações por guardar)
- Apagar receita, com confirmação
- Botão e gesto "voltar" regressam à lista

## v0.1.0 — 2026-10-24
- Lista de receitas ordenada alfabeticamente, com contagem de ingredientes e passos
- Criação de receita: título, ingredientes e passos (um por linha)
- Dados guardados localmente no telemóvel (IndexedDB)
- Instalável no ecrã principal do iPhone, com ícone próprio
- Funciona offline e atualiza-se sozinha quando há nova versão
