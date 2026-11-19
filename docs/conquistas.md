# Conquistas: como o Cartucho lê

O Cartucho **só lê**. Nunca escreve na pasta do jogo nem nos saves.

São três camadas. As duas primeiras estão prontas:

1. **Desbloqueios**: o arquivo onde o próprio recomp grava o que você conquistou.
2. **Lista original**: nomes, descrições, pontos e ícones tirados da sua cópia do jogo (no Xbox 360, o XDBF dentro do executável). Quando o jogo não tem isso, usamos a lista que está no código do recomp.
3. *(futuro)* Um protocolo aberto para recomps sem conquistas próprias avisarem o Cartucho.

Depois que um desbloqueio aparece, ele fica no banco do Cartucho mesmo que o save seja apagado, como na Steam. Quando o arquivo não guarda a data, usamos a hora em que o Cartucho viu o desbloqueio pela primeira vez.

## Recomps suportados

| Recomp | Como reconhece a pasta | Lista | Desbloqueios |
|---|---|---|---|
| UnleashedRecomp | `UnleashedRecomp.exe` | XDBF de `patched/default.xex` (gerado pelo instalador do recomp) | `%APPDATA%\UnleashedRecomp\save\ACH-DATA`, ou `<pasta>\save\ACH-DATA` se existir `portable.txt` |
| MarathonRecomp | `MarathonRecomp.exe` | XDBF de `decrypted/default.bin` | `%APPDATA%\MarathonRecomp\save\SonicNextAchievementData.bin` (mesma regra do `portable.txt`) |
| Sonic 3 A.I.R. | `Sonic3AIR.exe` | 18 conquistas do código do jogo | `<pasta>\savedata\storage\s3air_achievements.bin` se existir a pasta `savedata`, senão `%APPDATA%\Sonic3AIR\storage\…` |
| Sonic 1/2 (2013), RSDKv4 | `RSDKv4.exe` + `Data.rsdk` | 12 conquistas de cada jogo, do código do Retro Engine | `<pasta>\UData.bin` |

## Formatos

### hedge-dev (UnleashedRecomp e MarathonRecomp)

Little-endian, empacotado:

```
'ACH ' | version u32 (=1) | checksum u32 | reserved u32
N × { id u16, time_t i64, reserved u16[3] }      N = 50 (Unleashed) ou 23 (Marathon)
```

- O checksum é o XOR de todos os bytes dos registros. Se não confere (arquivo no meio da gravação), o Cartucho tenta de novo algumas vezes.
- Um id 0 encerra a lista.
- Os ids são os mesmos das conquistas no XDBF.

### Sonic 3 A.I.R. (Oxygen Engine, `PersistentData`)

```
'OXY.PDATA' | version u16 | count u32 | count × { key: len u32 + bytes, data: len u32 + bytes }
chave "Achievements": count u32 | count × { id u32, state u32 }      state ≠ 0 = conquistada
```

Não guarda a data.

### RSDKv4 (`UData.bin`)

```
64 × status i32 (100 = conquistada) | 128 × placar i32
```

Não guarda a data. O mesmo executável roda o Sonic 1 e o Sonic 2. O Cartucho escolhe a lista pelo título do catálogo (ou pelo nome da pasta, se houver "2").

### XDBF (Xbox 360)

Big-endian, conforme o `xdbf_utils` do Xenia:

- Seção 1, metadados: `XACH` (conquistas) e `XSTC` (idioma padrão).
- Seção 2, imagens PNG: o ícone de cada conquista e o do título (`0x8000`).
- Seção 3, textos: um bloco `XSTR` por idioma.

Os textos saem em português quando o jogo tem; senão em inglês; senão no idioma padrão do jogo.

### Executáveis

- **XEX2** sem criptografia, com compressão "nenhuma" ou "básica": é o que o UnleashedRecomp grava em `patched/`.
- **Imagem descriptografada do MarathonRecomp**: cabeçalho LE `0xDECDECDE`, `base`, `entry`, `resource_offset`, `resource_size` (36 bytes), seguido da imagem crua.

## Limitações conhecidas

- **XEX do disco**: vem criptografado e com compressão LZX, e o Cartucho não lê. Usamos o executável que o recomp gerou na instalação. Se a pasta `patched/` ou `decrypted/` não existir, a tela mostra o erro e os desbloqueios continuam sendo lidos (sem nome).
- **Mods que mudam a pasta do save** (o mod loader do UnleashedRecomp e o `redirectSave` do RSDK) ainda não são seguidos.
- **Sonic 1 × Sonic 2 no RSDKv4**: a escolha é por título ou nome da pasta, não pelo `Data.rsdk`.
- O Cartucho observa o arquivo por *polling* a cada 1,5 s. Isso funciona mesmo quando o arquivo ainda não existe e quando o jogo grava por renomeação.

## Licenças das listas embutidas

- `src/main/achievements/data/sonic3air.ts`: nomes e descrições das conquistas do Sonic 3 A.I.R., do código do projeto (GPL-3.0, Eukaryot).
- `src/main/achievements/data/rsdk4.ts`: nomes das conquistas do Sonic 1/2 (2013), do `RetroEngine.cpp` do RSDKv4-Decompilation (RSDKModding; RSDK original de Christian "Taxman" Whitehead; licença própria do projeto, uso não comercial).

São só textos de dados, citados com a fonte. Se o Cartucho for distribuído, vale confirmar com os autores ou trocar para leitura em tempo de execução a partir dos arquivos do próprio jogo.
