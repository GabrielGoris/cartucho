/**
 * Instalar, atualizar e desinstalar recomps a partir do GitHub.
 *
 * Cada jogo vai para a sua própria pasta dentro da pasta de jogos do Cartucho, com o nome do projeto
 * ("UnleashedRecomp"). Arquivos que já existirem ali são seus (de uma instalação anterior) e não são substituídos.
 */
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isSelfInstall, SELF_INSTALL_NOTE } from '@shared/consoles';
import type { InstallProgress, InstalledGame, InstalledRelease, UpdateInfo } from '@shared/types';
import { type DB, kvGet, kvSet } from '../db';
import type { AchievementService } from '../achievements/service';
import { type GitHub, type Release, githubToken, parseRepo } from './github';
import { NotReadyToRun, fetchRelease, filesIn, findGameExe, guessProgram, installInto, isRunning, manifestOf, placeRelease, removeInstalled, unpackRelease, type Progress } from './files';

const CHECK_MS = 3 * 3600_000;   // sem conta no GitHub são 60 consultas por hora: guardamos a resposta por 3 h

export class Ports {
  readonly events = new EventEmitter<{ progress: [InstallProgress] }>();
  private busy = new Set<string>();

  constructor(private db: DB, private games: AchievementService, private gh: GitHub, private portsDir: () => string, private running: (id: string) => boolean) {}

  private sender(key: string) { return (p: Progress) => this.events.emit('progress', { key, ...p }); }
  private toInstalled = (rel: Release, prev?: InstalledRelease | null): InstalledRelease =>
    ({ tag: rel.tag, assetId: rel.assetId, date: rel.publishedAt, uploader: rel.uploader ?? prev?.uploader ?? null });

  /** Instala o projeto de uma entrada do catálogo. A chave de progresso é o id do catálogo. */
  async installFromCatalog(catalogId: string): Promise<InstalledGame> {
    const cat = this.db.prepare('SELECT id, title, console, repo FROM catalog_game WHERE id = ?').get(catalogId) as { id: string; title: string; console: string; repo: string | null } | undefined;
    if (!cat) throw new Error('Esse jogo não está no catálogo.');
    if (!cat.repo) throw new Error('O catálogo não diz em qual projeto do GitHub este jogo está.');
    if (isSelfInstall(cat.console)) throw new Error(SELF_INSTALL_NOTE);
    const have = this.db.prepare('SELECT id FROM installed_game WHERE catalog_id = ? OR lower(source_repo) = lower(?)').get(catalogId, cat.repo) as { id: string } | undefined;
    if (have) throw new Error('Este jogo já está na sua biblioteca.');
    return this.install(parseRepo(cat.repo), { key: catalogId, catalogId, title: cat.title, console: cat.console });
  }

  async install(repo: string, opts: { key?: string; catalogId?: string; title?: string; console?: string } = {}): Promise<InstalledGame> {
    const key = opts.key ?? repo;
    if (this.busy.has(key)) throw new Error('Já está instalando.');
    this.busy.add(key);
    const send = this.sender(key);
    const tmp = await fsp.mkdtemp(join(tmpdir(), 'cartucho-'));
    try {
      send({ stage: 'Procurando a versão mais nova…', pct: 0 });
      const rel = await this.gh.findRelease(repo);
      const notReady = () => new NotReadyToRun(`${repo} não publica uma versão pronta para Windows (o jogo é montado a partir da sua cópia por uma ferramenta própria). Instale como a página do projeto explica e depois use "Adicionar jogo".`);
      if (/setup|install/i.test(rel.assetName) && /\.(exe|msi)$/i.test(rel.assetName)) throw notReady();
      if (/\.zip$/i.test(rel.assetName)) {
        send({ stage: 'Olhando dentro do pacote…', pct: 0 });
        const names = await this.gh.remoteZipNames(rel.url);
        if (names && !names.some(n => /\.exe$/i.test(n))) throw notReady();
      }
      const { archive, scan } = await fetchRelease(rel, tmp, send, this.gh.fetch, githubToken());
      const src = await unpackRelease(rel, archive, tmp, send);
      send({ stage: 'Copiando para a pasta de jogos…', pct: 1 });

      // Pasta própria com o nome do projeto. Se já foi instalado e removido antes, a mesma pasta de novo (com seus saves).
      const base = this.portsDir(); mkdirSync(base, { recursive: true });
      const used = (f: string) => !!this.db.prepare('SELECT 1 FROM installed_game WHERE lower(install_dir) = lower(?)').get(resolve(f));
      const name = repo.split('/')[1]!.replace(/[<>:"|?*]/g, '');
      let folder = join(base, name);
      for (let n = 2; used(folder); n++) folder = join(base, `${name} ${n}`);
      await fsp.mkdir(folder, { recursive: true });
      await fsp.cp(src, folder, { recursive: true, force: false, errorOnExist: false });
      const exe = findGameExe(folder) ?? guessProgram(folder, repo);
      if (!exe) { if ((await filesIn(folder)).length === (await filesIn(src)).length) await fsp.rm(folder, { recursive: true, force: true }); throw notReady(); }

      const game = await this.games.addGame(folder, {
        catalogId: opts.catalogId, title: opts.title, console: opts.console, exe, sourceRepo: repo,
        release: this.toInstalled(rel), managed: true, manifest: await manifestOf(src),
      });
      kvSet(this.db, `upd.${game.id}`, JSON.stringify({ at: Date.now(), latest: rel }));
      console.log(`[instalar] ${repo} ${rel.tag} (${rel.assetName}, defender: ${scan}) em ${folder}`);
      send({ stage: 'Pronto', pct: 1, done: true });
      return this.games.getGame(game.id);
    } catch (e) {
      send({ stage: 'Erro', pct: 0, done: true, error: (e as Error).message });
      throw e;
    } finally {
      this.busy.delete(key);
      fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }

  private status(g: InstalledGame, latest: Release | null, checkedAt: number | null, error?: string): UpdateInfo {
    const inst = this.games.internals(g.id).release;
    const updateAvailable = !latest ? null : inst?.assetId ? inst.assetId !== latest.assetId : inst?.tag ? inst.tag !== latest.tag : null;
    return {
      repo: g.sourceRepo, installed: inst?.tag ?? null, updateAvailable, checkedAt, error,
      latest: latest && { tag: latest.tag, name: latest.name, date: latest.publishedAt, notes: latest.notes.slice(0, 4000), page: latest.page, size: latest.size, assetName: latest.assetName },
    };
  }

  /** Há versão nova? Guarda a resposta por 3 h para não gastar o limite do GitHub. */
  async checkUpdate(gameId: string, force = false): Promise<UpdateInfo> {
    const g = this.games.getGame(gameId);
    if (!g.sourceRepo) return { repo: null, installed: g.version, latest: null, updateAvailable: null, checkedAt: null };
    const hit = JSON.parse(kvGet(this.db, `upd.${gameId}`) ?? 'null') as { at: number; latest: Release } | null;
    if (!force && hit && Date.now() - hit.at < CHECK_MS) return this.status(g, hit.latest, hit.at);
    try {
      const latest = await this.gh.findRelease(g.sourceRepo);
      kvSet(this.db, `upd.${gameId}`, JSON.stringify({ at: Date.now(), latest }));
      return this.status(g, latest, Date.now());
    } catch (e) {
      return this.status(g, hit?.latest ?? null, hit?.at ?? null, (e as Error).message);
    }
  }

  /** Baixa a versão nova e copia por cima (com cópia de segurança dos arquivos trocados). */
  async update(gameId: string) {
    const g = this.games.getGame(gameId);
    if (isSelfInstall(g.console)) throw new Error('O Cartucho não atualiza recomps deste console: instale a versão nova por cima da pasta do jogo.');
    if (!g.sourceRepo) throw new Error('Este jogo não tem um projeto do GitHub ligado a ele.');
    if (this.busy.has(gameId)) throw new Error('Já está atualizando.');
    if (this.running(gameId) || isRunning(g.exe)) throw new Error('Feche o jogo antes de atualizar.');
    this.busy.add(gameId);
    const send = this.sender(gameId);
    const tmp = await fsp.mkdtemp(join(tmpdir(), 'cartucho-'));
    try {
      send({ stage: 'Procurando a versão mais nova…', pct: 0 });
      const rel = await this.gh.findRelease(g.sourceRepo);
      const { release: inst, manifest } = this.games.internals(gameId);
      // Uma atualização só entra se veio da mesma conta da versão instalada: projeto que trocou de dono, ou arquivo de terceiros, para aqui.
      if (inst?.uploader && rel.uploader && inst.uploader.toLowerCase() !== rel.uploader.toLowerCase())
        throw new Error(`A versão ${rel.tag} foi publicada por outra conta (${rel.uploader}; antes era ${inst.uploader}). O Cartucho não instalou: confira a página do projeto.`);
      const exeName = g.exe?.split(/[\\/]/).pop()?.toLowerCase();
      if (exeName && /\.zip$/i.test(rel.assetName)) {
        send({ stage: 'Olhando dentro do pacote…', pct: 0 });
        const names = await this.gh.remoteZipNames(rel.url);
        if (names && !names.some(n => n.split('/').pop()!.toLowerCase() === exeName)) throw new NotReadyToRun(`${g.title} se atualiza pela própria ferramenta dele (o pacote novo não traz o ${exeName}).`);
      }
      const { archive, scan } = await fetchRelease(rel, tmp, send, this.gh.fetch, githubToken());
      const src = await unpackRelease(rel, archive, tmp, send);
      const root = g.exe ? placeRelease(src, g.exe) : g.installDir;
      if (!root) throw new NotReadyToRun(`${g.title} se atualiza pela própria ferramenta dele.`);
      const { kept, backup } = await installInto(root, src, inst?.tag ?? null, send);
      let exe = g.exe;
      if (exe && !existsSync(exe)) exe = guessProgram(root, g.sourceRepo);
      const newManifest = resolve(root) === resolve(g.installDir) ? { ...(manifest ?? {}), ...await manifestOf(src) } : manifest;
      this.games.patchGame(gameId, { exe, release: this.toInstalled(rel, inst), manifest: newManifest });
      kvSet(this.db, `upd.${gameId}`, JSON.stringify({ at: Date.now(), latest: rel }));
      console.log(`[atualizar] ${g.title} → ${rel.tag} (defender: ${scan}, ${kept.length} configurações mantidas)`);
      send({ stage: 'Pronto', pct: 1, done: true });
      return { ...this.status(this.games.getGame(gameId), rel, Date.now()), backup, kept: kept.length };
    } catch (e) {
      send({ stage: 'Erro', pct: 0, done: true, error: (e as Error).message });
      throw e;
    } finally {
      this.busy.delete(gameId);
      fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Só para jogos que o Cartucho instalou: apaga o que veio no download; arquivos seus (saves, mods) ficam. */
  async uninstall(gameId: string) {
    const g = this.games.getGame(gameId);
    if (!g.managed) throw new Error('O Cartucho só desinstala jogos que ele mesmo instalou. Use "Remover da biblioteca" (os arquivos ficam).');
    if (this.running(gameId) || isRunning(g.exe)) throw new Error('Feche o jogo antes.');
    const { manifest } = this.games.internals(gameId);
    if (!manifest) throw new Error('Não sei quais arquivos vieram com a instalação, então não apaguei nada.');
    let r;
    try { r = await removeInstalled(g.installDir, manifest); }
    catch (e) { throw new Error(/EBUSY|EPERM/.test((e as NodeJS.ErrnoException).code || '') ? 'Um arquivo está em uso. Feche o jogo e tente de novo.' : (e as Error).message); }
    this.games.removeGame(gameId);
    this.db.prepare('DELETE FROM kv WHERE key = ?').run(`upd.${gameId}`);
    return r;
  }
}
