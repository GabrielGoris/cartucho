# Cartucho

Hub de recomps, ports e emuladores: catálogo do Recompendium, radar de novidades, seus jogos instalados e as conquistas de cada um.

## O que já funciona

- **Abertura** com o cartucho entrando no console e o resumo da biblioteca (dá para desligar nas configurações).
- **Início**: o jogo mais recente em destaque e os outros numa fileira, navegável por setas ou controle.
- **Palco 3D** (React Three Fiber) com os 15 consoles, a mesa e a linha neon; nome, ano e contagem real de recomps e instalados por console.
- **Hub de cada console** (versão provisória): seus jogos daquele console, o catálogo dele e as conquistas.
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
      data/             listas que vêm do próprio código do recomp (Sonic 3 A.I.R., RSDKv4)
  preload/              ponte mínima (só o tRPC)
  renderer/             tela (React)
    public/models/      modelos 3D do palco (.glb) e CREDITOS.md
    src/stage/          palco 3D (R3F): consoles, carregamento dos modelos, cena
    src/views/          abertura, Início, hub do console, configurações, radar e perfil
    src/lib/            entrada (teclado/controle), navegação por setas, paletas, sons, configurações
  shared/               tipos e tabelas usados dos dois lados
test/                   testes com arquivos sintéticos montados byte a byte
docs/                   notas técnicas
```

## Créditos

- Modelos 3D: veja [src/renderer/public/models/CREDITOS.md](src/renderer/public/models/CREDITOS.md) (atenção às licenças NC, ND e à do PS2 antes de publicar).

- Catálogo: [Recompendium](https://recompendium.com/).
- Lógica de instalação e acompanhamento inspirada no [Harbour](https://github.com/) (MIT-0).
- Formatos do Xbox 360 conforme [Xenia](https://github.com/xenia-project/xenia) e [XenonRecomp](https://github.com/hedge-dev/XenonRecomp).
- Nomes das conquistas do Sonic 3 A.I.R. e do RSDKv4 vêm do código desses projetos; veja [docs/conquistas.md](docs/conquistas.md).
