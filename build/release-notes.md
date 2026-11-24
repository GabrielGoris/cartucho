## Cartucho 1.5.1

### Muito menos memória

- **Palco 3D mais leve:** as texturas dos consoles agora vão para a placa de vídeo já comprimidas, ocupando 4 vezes menos memória com a mesma aparência. Os modelos mais detalhados foram simplificados (o palco desenha um terço dos triângulos de antes) e a cópia de cada modelo que ficava sobrando na memória é solta depois de carregada. Em notebook com placa integrada, o Cartucho usa centenas de MB a menos.
- **Durante o jogo:** com um jogo aberto e o Cartucho em segundo plano, o palco 3D sai da memória depois de 20 segundos e volta quando você chama o Cartucho.
- O instalador ficou menor.

### Correções

- O PS2 aparecia de costas no palco.
- O ajuste "Palco pixelado" não funcionava; agora vem desligado e, se ligado, vale sempre.
- Em placas de vídeo sem suporte a texturas comprimidas (máquinas virtuais, drivers antigos), os consoles aparecem em cinza em vez de pretos.
