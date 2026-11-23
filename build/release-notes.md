## Cartucho 1.4.0

### Jogos do Windows no Linux

- **Wine/Proton por jogo**: programas do Windows (`.exe`, `.bat`, `.lnk`) rodam pelo umu-launcher com o Proton-GE que você já tem instalado, pelo Proton direto ou pelo Wine, cada jogo com o seu próprio prefixo.
- **Configurações > Wine** (e Opções do Wine na página de cada jogo): escolha o runner, a versão do Proton-GE, Proton-CachyOS ou Wine (dá para baixar de dentro do Cartucho), o DXVK (sempre a versão mais nova por padrão, ou a mais nova que a sua placa aceita; com versão async), VKD3D-Proton, componentes do winetricks, variáveis de ambiente e um prefixo que você já tenha. O registro da última execução fica na pasta do prefixo. Ao desinstalar, o Cartucho pergunta se apaga o prefixo também.
- **O Cartucho pergunta antes de baixar**: quando um jogo precisa de algo que ainda não está no computador (Proton-GE, DXVK, componentes do winetricks), o Cartucho mostra a lista com o tamanho e só baixa se você permitir. Dá para desligar a pergunta em Configurações > Wine.

### Downloads mais simples

- Os arquivos da versão agora dizem o sistema no nome: `Cartucho-1.4.0-windows.exe` e `Cartucho-1.4.0-linux.AppImage`. Os arquivos `latest.yml` e `latest-linux.yml` são os que o Cartucho usa para se atualizar sozinho.
