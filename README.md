# Cartucho

Hub de recomps, ports e emuladores: catálogo do Recompendium, radar de novidades, seus jogos instalados e as conquistas de cada um.

## O que já funciona

- **Abertura** com o cartucho entrando no console e o resumo da biblioteca (dá para desligar nas configurações).
- **Início**: o jogo mais recente em destaque e os outros numa fileira, navegável por setas ou controle.
- **Palco 3D** (React Three Fiber) com os 15 consoles, a mesa e a linha neon; nome, ano e contagem real de recomps e instalados por console.
- **Hubs no estilo de cada console**: Nintendo Switch e Switch 2 já têm o seu (fileira de blocos, atalhos redondos, telas com barra lateral, Jogar/Instalar/Atualizar, tempo de jogo e conquistas). Os outros consoles ainda usam o hub provisório.
- **Instalar e atualizar** pelo GitHub, direto da ficha do jogo no catálogo: escolhe o download certo para Windows, confere o hash publicado, passa no Windows Defender, desempacota numa pasta própria e acha o .exe. Atualizações só entram se vierem da mesma conta, guardam cópia dos arquivos trocados em `_cartucho-backup` e nunca sobrescrevem configurações (.ini, .toml, .cfg…) nem saves. Projetos cujo download não é o jogo pronto (ferramentas que montam o jogo a partir da sua cópia) são avisados antes de baixar.
- **Jogar e tempo de jogo**: o Jogar abre o .exe e acompanha até ele fechar, como na Steam (tempo total, sessões, últimos 14 dias). Com um jogo aberto, o palco 3D para de desenhar.
- **Desinstalar** apaga só o que veio no download; saves e configurações que você mudou ficam.
- **Imagens em boa resolução**: capas, artes de fundo e logos do [LaunchBox Games Database](https://gamesdb.launchbox-app.com/) (sem conta). Na primeira vez o Cartucho baixa o banco deles (~100 MB, atualizado uma vez por mês) e depois só as imagens dos jogos que aparecem na tela, guardadas em `media/` dentro dos dados do app. Sem o jogo lá, usa a capa do Recompendium.
- **Configurações** (tecla S ou ⚙): paletas, filtro CRT, moldura, brilho, palco pixelado, sons, abertura, botões do controle e menos movimento.
- **Controle**: teclado, Xbox, PlayStation e Nintendo; os botões na tela mudam conforme o controle conectado.

- **Catálogo** do [Recompendium](https://recompendium.com/), filtrado por console, com busca. Fica salvo no seu PC, então abre offline com a última cópia.
- **Radar**: depois da primeira carga, avisa jogo novo, mudança de status (ex.: Em progresso → Jogável) e versão nova de jogo que você tem.
- **Meus jogos**: você aponta a pasta onde o recomp está instalado e o Cartucho reconhece qual é.
- **Conquistas** (camadas 1 e 2): a lista original vem da sua cópia do jogo, e os desbloqueios vêm do arquivo que o próprio recomp grava. Enquanto o Cartucho está aberto, ele observa esse arquivo e avisa na hora quando você desbloqueia algo.

Recomps com conquistas suportados hoje: **UnleashedRecomp**, **MarathonRecomp** (Sonic 06), **Sonic 3 A.I.R.** e **Sonic 1/2 (2013)** do RSDKv4. Detalhes e limitações em [docs/conquistas.md](docs/conquistas.md).

## Como rodar

Precisa do **Node.js 22.13 ou mais novo** (recomendado o 24 LTS): https://nodejs.org

```bash
npm install
npm run dev
```

Não há módulo nativo para compilar: o banco usa o SQLite que já vem no Node/Electron, então não precisa de Python nem Visual Studio.

Atalhos: setas/Enter/Esc (ou o controle), Tab alterna Início/Consoles, Q/E trocam de console ou aba, S configurações, P troca a paleta, C troca os botões mostrados, M liga/desliga o som, F11 tela cheia.

Outros comandos:

| Comando | O que faz |
|---|---|
| `npm test` | testes dos leitores de arquivo e do serviço de conquistas |
| `npm run typecheck` | checagem de tipos |
| `npm run build` | gera o app em `out/` |
| `npm run dist` | gera o instalador do Windows em `release/` |

### Variáveis úteis para desenvolvimento

- `CARTUCHO_USER_DATA`: usa outra pasta de perfil (banco separado), sem mexer no seu.
- `CARTUCHO_CATALOG_URL`: lê o catálogo de outro endereço (por exemplo, um JSON local para testes).
- `CARTUCHO_GITHUB_API`: usa outro servidor no lugar de api.github.com (testes).
- `CARTUCHO_LAUNCHBOX_METADATA` / `CARTUCHO_LAUNCHBOX_IMAGES`: outro endereço para o banco e as imagens do LaunchBox (testes).
- `GITHUB_TOKEN` / `GH_TOKEN`, ou o GitHub CLI logado (`gh auth login`): sobe o limite de consultas do GitHub de 60 para 5.000 por hora.

Os jogos instalados pelo Cartucho vão para `%USERPROFILE%\Games\Cartucho` (dá para mudar em Configurações → Pasta dos jogos).

## Estrutura

```
src/
  main/                 processo principal (Electron)
    index.ts            janela, tRPC por IPC
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
    src/views/          abertura, Início, hub do console, configurações, radar e perfil
    src/lib/            entrada (teclado/controle), navegação por setas, paletas, sons, configurações
  shared/               tipos e tabelas usados dos dois lados
test/                   testes com arquivos sintéticos montados byte a byte
docs/                   notas técnicas
```

## Créditos

- Modelos 3D: veja [src/renderer/public/models/CREDITOS.md](src/renderer/public/models/CREDITOS.md) (atenção às licenças NC, ND e à do PS2 antes de publicar).

- Catálogo: [Recompendium](https://recompendium.com/).
- Imagens dos jogos: [LaunchBox Games Database](https://gamesdb.launchbox-app.com/).
- Lógica de instalação e acompanhamento inspirada no [Harbour](https://github.com/) (MIT-0).
- Formatos do Xbox 360 conforme [Xenia](https://github.com/xenia-project/xenia) e [XenonRecomp](https://github.com/hedge-dev/XenonRecomp).
- Nomes das conquistas do Sonic 3 A.I.R. e do RSDKv4 vêm do código desses projetos; veja [docs/conquistas.md](docs/conquistas.md).
