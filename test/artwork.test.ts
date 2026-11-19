/** Imagens do LaunchBox: índice a partir do Metadata.zip, busca por nome e cache em disco. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readDatabase } from '../src/main/artwork/launchbox';
import { Artwork, artPlatform, looseKey } from '../src/main/artwork/service';
import { Writer } from './fixtures';

const tmp = () => mkdtempSync(join(tmpdir(), 'cartucho-'));
const XML = `<?xml version="1.0"?><LaunchBox>
<Game><Name>Pokémon Pokopia</Name><DatabaseID>1</DatabaseID><Platform>Nintendo Switch 2</Platform></Game>
<Game><Name>The Legend of Zelda: Ocarina of Time</Name><DatabaseID>2</DatabaseID><Platform>Nintendo Switch 2</Platform></Game>
<Game><Name>Sonic the Hedgehog</Name><DatabaseID>3</DatabaseID><Platform>Sega Genesis</Platform></Game>
<Game><Name>Algo de outra plataforma</Name><DatabaseID>4</DatabaseID><Platform>Atari Jaguar</Platform></Game>
<GameAlternateName><AlternateName>Pokopia</AlternateName><DatabaseID>1</DatabaseID></GameAlternateName>
<GameImage><DatabaseID>1</DatabaseID><FileName>pk-eu.png</FileName><Type>Box - Front</Type><Region>Europe</Region></GameImage>
<GameImage><DatabaseID>1</DatabaseID><FileName>pk-us.png</FileName><Type>Box - Front</Type><Region>North America</Region></GameImage>
<GameImage><DatabaseID>1</DatabaseID><FileName>pk-bg.jpg</FileName><Type>Fanart - Background</Type></GameImage>
<GameImage><DatabaseID>3</DatabaseID><FileName>sonic.png</FileName><Type>Box - Front</Type><Region>North America</Region></GameImage>
<GameImage><DatabaseID>4</DatabaseID><FileName>x.png</FileName><Type>Box - Front</Type></GameImage>
</LaunchBox>`;

/** Zip com Metadata.xml comprimido (deflate), como o do LaunchBox. */
function metadataZip() {
  const data = Buffer.from(XML), packed = deflateRawSync(data), name = Buffer.from('Metadata.xml');
  const local = new Writer(true).u32(0x04034b50).u16(20).u16(0).u16(8).u16(0).u16(0).u32(0).u32(packed.length).u32(data.length).u16(name.length).u16(0).raw(name).raw(packed).bytes();
  const central = new Writer(true).u32(0x02014b50).u16(20).u16(20).u16(0).u16(8).u16(0).u16(0).u32(0).u32(packed.length).u32(data.length).u16(name.length).u16(0).u16(0).u16(0).u16(0).u32(0).u32(0).raw(name).bytes();
  return Buffer.from(new Writer(true).raw(local).raw(central).u32(0x06054b50).u16(0).u16(0).u16(1).u16(1).u32(central.length).u32(local.length).u16(0).bytes());
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);

let server: Server, base = '', zipHits = 0;
beforeAll(async () => {
  const zip = metadataZip();
  server = createServer((req, res) => {
    if (req.url === '/Metadata.zip') { zipHits++; res.writeHead(200, { 'content-length': zip.length }); return res.end(zip); }
    if (req.url === '/img/pk-us.png') { res.writeHead(200); return res.end(PNG); }
    if (req.url === '/img/pk-bg.jpg') { res.writeHead(200); return res.end(JPG); }
    if (req.url === '/img/sonic.png') { res.writeHead(200); return res.end(Buffer.from('<html>não é imagem</html>')); }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

describe('nomes', () => {
  it('chave solta ignora artigo, acento, pontuação e parênteses', () => {
    expect(looseKey('The Legend of Zelda: Ocarina of Time (2026)')).toBe(looseKey('Legend of Zelda - Ocarina of Time'));
    expect(looseKey('Pokémon Pokopia')).toBe('pokemonpokopia');
  });
  it('"Outros" vira a plataforma de origem', () => {
    expect(artPlatform('other', 'Mega Drive / Genesis')).toBe('megadrive');
    expect(artPlatform('other', 'Panasonic M2')).toBeNull();
    expect(artPlatform('switch2')).toBe('switch2');
  });
});

describe('banco do LaunchBox', () => {
  it('lê o XML do zip, só plataformas conhecidas, imagens da América do Norte primeiro', async () => {
    const dir = tmp(); writeFileSync(join(dir, 'm.zip'), metadataZip());
    const i = await readDatabase(join(dir, 'm.zip'), looseKey);
    expect(i.names['Nintendo Switch 2']!['pokopia']).toEqual(['1']);
    expect(i.images['Nintendo Switch 2']!['1']!.cover).toEqual(['pk-us.png', 'pk-eu.png']);
    expect(i.names['Atari Jaguar']).toBeUndefined();
  });

  it('baixa o banco uma vez, busca e guarda as imagens, e avisa quando chegam', async () => {
    const dir = tmp();
    const art = new Artwork(dir, fetch as never, { metadataUrl: `${base}/Metadata.zip`, imageUrl: `${base}/img` });
    let changed = 0; art.events.on('changed', () => changed++);
    expect(art.get('switch2', null, ['Pokémon Pokopia'])).toEqual({});        // nada em disco ainda: busca em segundo plano
    expect(art.get('switch2', null, ['Pokémon Pokopia'])).toEqual({});        // pedir de novo não duplica
    await new Promise<void>(ok => { const t = setInterval(() => { if (changed) { clearInterval(t); ok(); } }, 50); });
    await new Promise(r => setTimeout(r, 300));
    const got = art.get('switch2', null, ['Pokémon Pokopia']);
    expect(got.cover).toBe('media://art/switch2/cover/pokemonpokopia.png');
    expect(got.fanart).toBe('media://art/switch2/fanart/pokemonpokopia.jpg');
    expect(got.logo).toBeUndefined();
    expect(zipHits).toBe(1);
    expect(art.resolve('/switch2/cover/pokemonpokopia.png')).toBe(join(dir, 'switch2', 'cover', 'pokemonpokopia.png'));
    expect(art.resolve('/../../etc/passwd')).toBeNull();

    // o servidor devolveu HTML no lugar da imagem: não é guardado
    art.get('other', 'Mega Drive / Genesis', ['Sonic the Hedgehog'], ['cover']);
    await new Promise(r => setTimeout(r, 500));
    expect(art.get('other', 'Mega Drive / Genesis', ['Sonic the Hedgehog'], ['cover'])).toEqual({});
  });
});
