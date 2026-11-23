## Cartucho 1.3.0

### Novo: Cartucho no Linux

- **AppImage para Linux**: baixe o arquivo `.AppImage`, dê permissão de execução e abra. Ele se atualiza sozinho, como no Windows. Para tudo funcionar, instale `xdotool`, `wmctrl` e `libfuse2` (no Ubuntu e no Mint 22: `sudo apt install xdotool wmctrl libfuse2t64`).
- **Jogos do Windows pelo Proton**: jogos da biblioteca da Steam abrem pela própria Steam. Outros programas do Windows rodam pelo umu-launcher, pelo Proton que já vem com a Steam ou pelo Wine, cada jogo com a sua própria pasta de configurações. Recomps sem versão para Linux baixam a versão do Windows e rodam pelo Proton.
- **Tempo de jogo, emuladores e conquistas**: o tempo conta também para jogos abertos por fora do Cartucho e pelo Proton, e as conquistas são lidas dentro da pasta do Proton.
- **Atalhos do controle durante o jogo**: segurar o botão Xbox chama o Cartucho e Xbox + RB tira a captura, com o controle lido direto pelo sistema.
- **Captura de tela**: no X11, a captura é do instante do primeiro botão. No Wayland, a captura passa pelo sistema, que pode pedir permissão na primeira vez.
- **Abrir junto com o sistema e atalho na área de trabalho** funcionam no Linux.

### Bom saber

- No Wayland, o Cartucho não consegue vir para a frente sozinho: é uma regra do próprio sistema.
- No GNOME, o ícone perto do relógio só aparece com a extensão AppIndicator. As configurações avisam quando ela falta.

Gostou? Dá para apoiar em [buymeacoffee.com/goris](https://buymeacoffee.com/goris).
