# Changelog

## v1.1.0 — 2026-10-26
- Nova secção "Nutrição" no formulário e no detalhe, entre os Passos e as Notas
- Campos: Porção (por omissão "1 dose"), Calorias, Gorduras Total, Gorduras Saturada, Colesterol, Sódio, Carboidrato Total, Fibra dietética, Açúcares e Proteína
- No detalhe só aparecem os valores preenchidos; a secção não aparece se estiver vazia
- Backup e importação incluem a nutrição
- Correção: no ecrã Definições, os botões Exportar/Importar ficavam espremidos e sem resposta ao toque quando o conteúdo não cabia no ecrã

## v1.0.0 — 2026-10-25
Primeira versão completa.
- Novo ecrã "Definições" (botão da roda dentada): Aparência, Organizar (pratos e categorias), Cópia de segurança e Sobre
- Aparência: Claro, Escuro ou Sistema (segue o iPhone); a escolha fica guardada
- Modo escuro em toda a app, incluindo modo cozinhar e barra de estado
- Ecrã de arranque com o ícone (claro e escuro) para os vários tamanhos de iPhone
- Funcionamento offline revisto e testado
- Melhor contraste do texto secundário e botões de porções maiores

## v0.9.0 — 2026-10-25
- Fotografia da receita: tirar com a câmara ou escolher da galeria, alterar ou remover
- Imagens reduzidas automaticamente para poupar espaço no telemóvel
- Miniatura na lista e foto em destaque no topo do detalhe
- Backup e importação incluem as fotografias

## v0.8.0 — 2026-10-25
- Ajuste de porções com botões − / + no detalhe e no modo cozinhar
- As quantidades dos ingredientes são recalculadas e destacadas (inteiros, decimais, frações como ½ e ¾, e intervalos como 2-3)
- Ingredientes sem quantidade (ex.: sal q.b.) ficam iguais
- Botão para repor as porções originais

## v0.7.0 — 2026-10-25
- Modo cozinhar: botão "Cozinhar" no detalhe abre um ecrã próprio com letra grande
- Ecrã mantém-se ligado enquanto se cozinha (iOS 16.4 ou mais recente)
- Ingredientes que se riscam com um toque, com contador
- Passos um de cada vez, com botões Anterior/Seguinte e gesto de deslizar
- Filtro de categorias passa a ter "Todas" e a permitir só uma categoria de cada vez

## v0.6.0 — 2026-10-25
- Favoritos: botão ♥ no detalhe da receita, coração na lista e filtro "♥ Favoritas"
- Ordenação da lista: A–Z, mais recentes ou mais rápidas (fica guardada)
- Categorias base passam a começar por maiúscula (Carne, Peixe, Vegetariano…), incluindo as já atribuídas às receitas

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
