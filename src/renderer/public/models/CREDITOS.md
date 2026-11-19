# Modelos 3D do palco

Baixados do Sketchfab, exceto o do PS2 (CGTrader, convertido de FBX para GLB com os materiais originais). Os arquivos não foram alterados: o Cartucho gira, normaliza o tamanho
e esconde peças na hora de carregar (src/renderer/src/stage/models.ts).

| Console | Arquivo | Autor | Licença |
|---|---|---|---|
| Super Nintendo | super_nintendo_game_console.glb | Laser Design | CC BY-NC 4.0 |
| Nintendo 64 | nintendo_64.glb | Joseph Rohm | CC BY 4.0 |
| GameCube | gamecube_console.glb | Jeffrey fan 2000 | CC BY 4.0 |
| Wii | wii.glb | elouisetrewartha | CC BY-NC 4.0 |
| Nintendo Switch | nintendo_switch.glb | Smoggybeard | CC BY-NC-SA 4.0 |
| Nintendo Switch 2 | nintendo_switch_2.glb | NAIT Studio | CC BY 4.0 |
| PlayStation | playstation_1.glb | ecjhr0awipso | CC BY 4.0 |
| PlayStation 2 | playstation_2.glb | ATEZ (CGTrader) | Editorial License (no AI) — **fora do repositório** |
| PSP | sony_psp.glb | Ilya Ostrovsky | CC BY 4.0 |
| PlayStation 3 | ps3_slim.glb | Vasily | CC BY 4.0 |
| PlayStation 4 | playstation_4_original.glb | Laxity | CC BY 4.0 |
| PlayStation 5 | playstation_5_digital_edition.glb | DatSketch | CC BY-ND 4.0 |
| Xbox 360 | xbox_360_black.glb | Rob Bryant, Jr | CC BY 4.0 |
| PC | retro_crt_computer_1990s_desktop_pc.glb | MadeByYeshe | CC BY 4.0 |
| Outros (fliperama) | pacman_arcade.glb | Daniel Brück | CC BY 4.0 |

Atenção antes de publicar o código ou o app:
- NC (não comercial): ok para um app gratuito.
- ND (PS5): não pode distribuir versão modificada do arquivo. Por isso a compressão de modelos não deve mexer nele.
- PS2 (CGTrader, Editorial License): não permite redistribuir o arquivo nem usá-lo num produto. Por isso
  `playstation_2.glb` está no .gitignore: fica só na sua pasta, e quem clonar o repositório vê a plataforma vazia
  até ter um modelo próprio. Para distribuir o Cartucho, o PS2 precisa de um modelo com licença CC BY/CC0.
