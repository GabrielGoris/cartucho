## Cartucho 1.3.0

### Novo: Cartucho no Linux

- **AppImage para Linux**: baixe o arquivo `.AppImage`, dê permissão de execução e abra. Ele se atualiza sozinho, como no Windows. Para tudo funcionar, instale `xdotool`, `wmctrl` e `libfuse2` (no Ubuntu e no Mint 22: `sudo apt install xdotool wmctrl libfuse2t64`).
- **Jogos do Windows pelo Wine/Proton**: jogos da biblioteca da Steam abrem pela própria Steam. Outros programas do Windows (`.exe`, `.bat`, `.lnk`) rodam pelo umu-launcher com o Proton-GE que você já tem instalado, pelo Proton direto ou pelo Wine, cada jogo com o seu próprio prefixo. Recomps sem versão para Linux baixam a versão do Windows e rodam por aí.
- **Configurações > Wine** (e Opções do Wine na página de cada jogo): escolha o runner, a versão do Proton-GE, Proton-CachyOS ou Wine (dá para baixar de dentro do Cartucho), o DXVK (sempre a versão mais nova por padrão, ou a mais nova que a sua placa aceita; com versão async), VKD3D-Proton, componentes do winetricks, variáveis de ambiente e um prefixo que você já tenha. O registro da última execução fica na pasta do prefixo. Ao desinstalar, o Cartucho pergunta se apaga o prefixo também.
- **Tempo de jogo, emuladores e conquistas**: o tempo conta também para jogos abertos por fora do Cartucho e pelo Proton, e as conquistas são lidas dentro da pasta do Proton.
- **Atalhos do controle durante o jogo**: segurar o botão Xbox chama o Cartucho e Xbox + RB tira a captura, com o controle lido direto pelo sistema.
- **Captura de tela**: no X11, a captura é do instante do primeiro botão. No Wayland, a captura passa pelo sistema, que pode pedir permissão na primeira vez.
- **Abrir junto com o sistema e atalho na área de trabalho** funcionam no Linux.

### Bom saber

- No Wayland, o Cartucho não consegue vir para a frente sozinho: é uma regra do próprio sistema.
- No GNOME, o ícone perto do relógio só aparece com a extensão AppIndicator. As configurações avisam quando ela falta.

Gostou? Dá para apoiar em [buymeacoffee.com/goris](https://buymeacoffee.com/goris).
