# Cartucho

Hub de recomps, ports e emuladores: catálogo do Recompendium, radar de novidades, seus jogos instalados e as conquistas de cada um.

## Aviso legal

O Cartucho é um projeto pessoal e gratuito, sem nenhuma ligação com Nintendo, Sony, Microsoft, Sega ou qualquer outra fabricante ou editora. Os nomes de consoles e jogos aparecem só para identificar com o que cada recomp funciona, e pertencem aos seus donos.

- O Cartucho **não contém nem distribui** jogos, ROMs, chaves, firmware, BIOS ou arquivos de qualquer jogo.
- Os recomps precisam de uma **cópia do jogo que você comprou**, extraída por você do seu próprio console ou mídia. O Cartucho não ensina nem ajuda a obter esses arquivos de outro jeito.
- A lista de jogos vem do [Recompendium](https://recompendium.com/) e as imagens do [LaunchBox Games Database](https://gamesdb.launchbox-app.com/), consultados no seu PC; nada disso fica neste repositório.
- Para os consoles que ainda estão à venda (hoje, **Nintendo Switch e Switch 2**), o Cartucho não baixa nem atualiza nada: mostra só quais jogos têm recomp, sem link nem nome do projeto. Você pesquisa e instala por conta própria e depois adiciona a pasta no Cartucho.

## Baixar

Baixe o instalador (`Cartucho-x.y.z-windows.exe`, ou `Cartucho-x.y.z-linux.AppImage` no Linux) na página de [Releases](https://github.com/GabrielGoris/cartucho/releases/latest). Depois de instalado, o Cartucho se atualiza sozinho.

Como o instalador não tem assinatura digital, o Windows pode mostrar "O Windows protegeu o computador": clique em **Mais informações** e depois em **Executar assim mesmo**.

## Apoie

O Cartucho é de graça e vai continuar sendo. Se ele te ajudou, dá para apoiar em [buymeacoffee.com/goris](https://buymeacoffee.com/goris) (também em Configurações e no menu do Start/≡ do controle).

## O que ele faz

- **Palco 3D** com 20 lugares (NES, Game Boy, SNES, N64, GameCube, DS, Wii, Switch, Switch 2, PS1 a PS5, PSP, Xbox, Xbox 360, Mega Drive, PC e Outros). Você escolhe quais aparecem; os escondidos vão para **Outros**, separados por plataforma.
- **Um hub com a cara de cada console**, com o mesmo jeito de usar em todos: **Meus jogos** (nos consoles antigos, em cartuchos e caixas parecidos com os de verdade), **Descobrir** (destaques, filtros, ordenação e busca), novidades, conquistas, tempo de jogo e ajustes.
- **Todos os jogos**: o catálogo inteiro de todos os consoles numa tela só, com filtro por console.
- **Página do jogo** no mesmo padrão em todos os hubs: capa em tamanho original, ações, capturas de tela e descrição.
- **Instalar e atualizar** pelo GitHub, direto do catálogo (exceto Switch e Switch 2, veja o aviso acima): escolhe o download certo, confere o hash, passa no Windows Defender e acha o .exe. Atualizações guardam cópia do que foi trocado e nunca mexem em configurações nem saves.
- **Tempo de jogo como na Steam**, inclusive de jogos abertos fora do Cartucho, enquanto ele estiver aberto ou na bandeja. Dá para abrir com o Windows e criar atalho na Área de Trabalho que abre o jogo pelo Cartucho.
- **Conquistas** lidas dos arquivos dos próprios recomps, com aviso na hora em que você desbloqueia. Suportados hoje: **UnleashedRecomp**, **MarathonRecomp** (Sonic 06), **Sonic 3 A.I.R.** e **Sonic 1/2 (2013)** do RSDKv4. Detalhes em [docs/conquistas.md](docs/conquistas.md).
- **Radar**: avisa jogo novo no catálogo, mudança de status e versão nova de jogo que você tem.
- **Controle em tudo**: Xbox, PlayStation e Nintendo, com teclado na tela para a busca, seletor de pastas e confirmações dentro do app. Teclado e mouse também funcionam.
- **Imagens** do [LaunchBox Games Database](https://gamesdb.launchbox-app.com/) e **textos traduzidos** para o português pelo [MyMemory](https://mymemory.translated.net/), guardados no seu PC.
- **Perfil, paletas, filtro CRT, sons, tela cheia** (Alt+Enter ou F11) e janela que lembra o tamanho e a posição.

## Como rodar

Precisa do **Node.js 22.13 ou mais novo** (recomendado o 24 LTS): https://nodejs.org

```bash
npm install
npm run dev
```

Não há módulo nativo para compilar: o banco usa o SQLite que já vem no Node/Electron, então não precisa de Python nem Visual Studio.

Atalhos: setas/Enter/Esc (ou o controle), Tab alterna Início/Consoles, Q/E trocam de console ou aba, X ações, Y busca, F1 menu (Start), F2 Select, S configurações, P troca a paleta, C troca os botões mostrados, M liga/desliga o som, Alt+Enter ou F11 tela cheia.

Outros comandos:

| Comando | O que faz |
|---|---|
| `npm test` | testes dos leitores de arquivo e do serviço de conquistas |
| `npm run typecheck` | checagem de tipos |
| `npm run build` | gera o app em `out/` |
| `npm run dist` | gera o instalador do Windows em `release/` (no Windows) |

### Variáveis úteis para desenvolvimento

- `CARTUCHO_USER_DATA`: usa outra pasta de perfil (banco separado), sem mexer no seu.
- `CARTUCHO_CATALOG_URL`: lê o catálogo de outro endereço (por exemplo, um JSON local para testes).
- `CARTUCHO_GITHUB_API`: usa outro servidor no lugar de api.github.com (testes).
- `CARTUCHO_LAUNCHBOX_METADATA` / `CARTUCHO_LAUNCHBOX_IMAGES`: outro endereço para o banco e as imagens do LaunchBox (testes).
- `CARTUCHO_TRANSLATE_URL`: outro servidor no lugar do MyMemory (testes).
- `GITHUB_TOKEN` / `GH_TOKEN`, ou o GitHub CLI logado (`gh auth login`): sobe o limite de consultas do GitHub de 60 para 5.000 por hora.

Os jogos instalados pelo Cartucho vão para `%USERPROFILE%\Games\Cartucho` (dá para mudar em Configurações → Pasta dos jogos).

## Lançar uma versão

1. Mude a versão no `package.json` (ex.: `1.0.1`) e faça o commit.
2. Crie a tag e envie: `git tag v1.0.1` e `git push origin main --follow-tags`.
3. O workflow **Lançar versão** roda os testes, gera o instalador e publica no GitHub Releases. Quem já tem o Cartucho recebe a atualização sozinho.

## Estrutura

```
src/
  main/                 processo principal (Electron)
    index.ts            app, tRPC por IPC
    window.ts           janela, tela cheia e barra de título
    background.ts       bandeja, abrir com o Windows e atalhos
    updater.ts          atualização automática (GitHub Releases)
    router.ts           tudo que a tela pode pedir
    db.ts               SQLite (node:sqlite) + migrações
    catalog.ts          catálogo do Recompendium + radar
    achievements/
      adapters.ts       um adaptador por recomp: onde está a lista, onde estão os desbloqueios
      service.ts        sincroniza, guarda no banco, observa o arquivo e avisa
      xdbf.ts xex.ts    lista original dos jogos de Xbox 360
      saves.ts          leitores dos arquivos de desbloqueio
    ports/              instalar/atualizar pelo GitHub (github.ts, files.ts, installer.ts)
    play.ts             abrir o jogo e contar o tempo
    artwork/            imagens do LaunchBox (índice do banco e cache em disco)
      data/             listas que vêm do próprio código do recomp (Sonic 3 A.I.R., RSDKv4)
  preload/              ponte mínima (só o tRPC)
  renderer/             tela (React)
    public/models/      modelos 3D do palco (.glb) e CREDITOS.md
    src/stage/          palco 3D (R3F): consoles, carregamento dos modelos, cena
    src/hubs/           hubs no estilo de cada console (dados e ações comuns em data.ts)
    src/components/     Descobrir, página do jogo, teclado na tela, barra de título
    src/views/          abertura, Início, Todos os jogos, configurações, radar, perfil e apoio
    src/lib/            entrada (teclado/controle), navegação por setas, paletas, sons, configurações
  shared/               tipos e tabelas usados dos dois lados
test/                   testes com arquivos sintéticos montados byte a byte
docs/                   notas técnicas
```

## Créditos

- Modelos 3D: veja [src/renderer/public/models/CREDITOS.md](src/renderer/public/models/CREDITOS.md) (cada modelo tem a sua licença; os NC só podem ser usados sem fins comerciais).

- Catálogo: [Recompendium](https://recompendium.com/).
- Imagens dos jogos: [LaunchBox Games Database](https://gamesdb.launchbox-app.com/).
- Lógica de instalação e acompanhamento inspirada no Harbour (MIT-0).
- Formatos do Xbox 360 conforme [Xenia](https://github.com/xenia-project/xenia) e [XenonRecomp](https://github.com/hedge-dev/XenonRecomp).
- Nomes das conquistas do Sonic 3 A.I.R. e do RSDKv4 vêm do código desses projetos; veja [docs/conquistas.md](docs/conquistas.md).

## Licença

O código é MIT (veja [LICENSE](LICENSE)). Os modelos 3D têm as licenças dos seus autores, listadas em CREDITOS.md.
