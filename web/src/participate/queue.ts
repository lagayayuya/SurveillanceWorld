// Send queue: every contribution is stored in IndexedDB under its uuid first, then sent
// with POST /api/contributions, uuid in the body (never in the URL, which Caddy logs when
// a proxied request fails), idempotent on it: sending twice creates nothing.
// What did not leave is sent again when the network comes back, at startup, when the page
// shows again, after any successful API call, and every 15 s while something waits.
// A definitive refusal (4xx other than 401 and 429) drops the item: sending it again would
// give the same answer (?debug=1 says so). A 401 (no session, or an expired one: lot
// « comptes ») never drops anything: the queue keeps every item, says it needs a login
// (`needsLogin`), and sends nothing more until one (`resume`). A piece of a « Modifier » send takes the whole send
// with it, its pieces already arrived withdrawn, and its author is told: one send never
// lands in part. An add leaves before anything else: the answers about the camera it
// creates name it by its id.
import { debugEvent } from "../debug";
import { ApiError, call, isNetworkError, onReachable, withdrawSent } from "./api";

export type Contribution = {
  kind:
    | "verify"
    | "move"
    | "agree"
    | "disagree"
    | "shape"
    | "direction"
    | "operator"
    | "add"
    | "height"
    | "tilt";
  /** Every kind but `add`, whose camera id follows from its uuid (addedId). */
  camera?: string;
  build_id: string;
  day: string;
  /** No longer sent (lot 4 of /revue: the gesture's duration is not kept); an item queued
   * by an older page may still hold it, and leaves as it is (the API accepts it, keeps
   * nothing). */
  duration_ms?: number;
  on_site: boolean | null;
  // verify; shape, direction ("not_visible"), operator (phase D2)
  answer?:
    | "present"
    | "not_found"
    | "unsure"
    | "dome"
    | "bullet"
    | "ptz"
    | "multi"
    | "multidome"
    | "unknown"
    | "not_visible"
    | "public"
    | "business"
    | "household"
    // height, tilt (phase D3): classes of rules/questions.yaml
    | "ground"
    | "first"
    | "upper"
    | "pole"
    | "horizon"
    | "slight"
    | "steep";
  // shape « Multi-boules »: its number of domes (questions@6 dome_count); absent: « Je ne
  // sais pas », or another shape
  dome_count?: number;
  // direction: bearing from the camera to the target, whole degrees 0-359
  direction?: number;
  // operator: a name from the list the server offered (public, business), or (punk, the
  // lot of 2026-10-12) a name not listed, shown nowhere before review; never both
  operator_name?: string;
  operator_proposed?: string;
  // move, add: the requested point (the server places it)
  lon?: number;
  lat?: number;
  placement?: "facade" | "free";
  // agree / disagree
  target?: string;
  // height, tilt (phase D3): what the same journey answered before, for /revue's field
  aim_kind?: string;
  aim_direction?: number;
  aim_height?: string;
  // « Modifier »: the send this piece belongs to (its pieces leave and are withdrawn
  // together); a direction aimed from where the same send moves the camera
  batch?: string;
  from_lon?: number;
  from_lat?: number;
};
/** `owner`: the signed-in account's pseudonym (lowercased) when it was queued, so that on a
 * shared phone one person's sends never leave under another's session; none before
 * accounts (anyone's). */
export type Item = { uuid: string; body: Contribution; tries: number; owner?: string };

const DB = "participation";
const STORE = "outbox";
// While something waits: the "online" event does not always come (CI's WebKit missed it
// once), so the queue also tries again on this timer, when the page shows again, and when
// another API call has just succeeded.
const RETRY_MS = 15_000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "uuid" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    t.onerror = () => reject(t.error);
  });
}

export class Queue {
  /** Items waiting, as last read (for the counter and the pending layer). */
  items: Item[] = [];
  dropped = 0;
  /** The API answered a send 401: what waits stays until a login (resume). */
  needsLogin = false;
  /** Who is signed in (lowercased pseudonym; null signed out or unknown): `items` holds
   * that account's sends only (and those of no one), the others wait for their own. */
  owner: string | null = null;
  private flushing: Promise<void> | null = null;
  /** Why a flush was asked while one ran (it runs once more), or null. */
  private again: string | null = null;
  private timer = 0;
  /** Being withdrawn: never sent meanwhile (nor, for an add, the answers on its camera). */
  private withheld = new Set<string>();
  /** « Modifier » sends a piece of which left the phone since the page loaded. */
  private leftBatches = new Set<string>();
  /** Contributions the API answered `osm: "will_publish"` (the OSM synchronisation: her
   * choice is on and they can leave once accepted), since the page loaded. */
  private willPublish = new Set<string>();
  /** Told of each uuid added to willPublish (the points' scene, score.ts). */
  private publishWatchers = new Set<(uuid: string) => void>();
  /** Contributions the API answered `osm: "kept"`: her choice is on, but a rule keeps them
   * on Surveillance World (`osm_reason`: multidome_count_unknown, « Multi-boules » without
   * its number), since the page loaded. */
  private keptReasons = new Map<string, string>();
  private keptWatchers = new Set<(uuid: string, reason: string) => void>();

  constructor(
    private onChange: (q: Queue) => void,
    /** A « Modifier » send refused: none of it is kept (its author is told). */
    private onRefused: (batch: string) => void = () => {},
  ) {
    // Waiting for a login, none of these sends: each would be answered 401 again.
    window.addEventListener("online", () => {
      if (!this.needsLogin) void this.flush("online");
    });
    onReachable(() => {
      if (this.items.length && !this.flushing && !this.needsLogin) void this.flush("reachable");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.items.length && !this.needsLogin)
        void this.flush("visible");
    });
    void this.flush("startup");
  }

  /** Signed in (again): what waited for a login leaves. */
  resume(): void {
    if (!this.needsLogin) return;
    this.needsLogin = false;
    void this.flush("login");
  }

  /** `uuid`: chosen beforehand for an add, whose camera id comes from it. */
  async add(body: Contribution, uuid: string = crypto.randomUUID()): Promise<string> {
    // v4: no time inside
    await tx("readwrite", (s) => s.put({ uuid, body, tries: 0, ...this.mark() } satisfies Item));
    await this.refresh();
    void this.flush("new");
    return uuid;
  }

  /** Several contributions in one IndexedDB transaction (an add and its answers, phase
   * "Retours terrain": they leave together, or none is stored). */
  async addAll(items: { uuid: string; body: Contribution }[]): Promise<void> {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE, "readwrite");
      const store = t.objectStore(STORE);
      for (const { uuid, body } of items)
        store.put({ uuid, body, tries: 0, ...this.mark() } satisfies Item);
      t.oncomplete = () => {
        db.close();
        resolve();
      };
      t.onerror = () => reject(t.error);
    });
    await this.refresh();
    void this.flush("new");
  }

  private mark(): { owner?: string } {
    return this.owner ? { owner: this.owner } : {};
  }

  async refresh(): Promise<void> {
    try {
      const all = await tx("readonly", (s) => s.getAll() as IDBRequest<Item[]>);
      const owner = this.owner;
      this.items = all.filter((i) => !i.owner || !owner || i.owner === owner);
    } catch (e) {
      debugEvent(`queue unreadable (${e instanceof Error ? e.name : "?"})`);
      this.items = [];
    }
    this.onChange(this);
  }

  /** Take a contribution out unsent (withdrawn by its author), with, for an add, the
   * answers on the camera it creates, and for a piece of a « Modifier » send, the send's
   * other pieces (some may have left already: Participation.withdraw asks the server).
   * The items taken out, `uuid`'s first; none: it had already left (ask the server). */
  async remove(uuid: string): Promise<Item[]> {
    this.withheld.add(uuid);
    try {
      await this.flushing; // never while it is being sent
      const items = await tx("readonly", (s) => s.getAll() as IDBRequest<Item[]>);
      const item = items.find((i) => i.uuid === uuid);
      if (!item) return [];
      const camera = item.body.kind === "add" ? addedId(uuid) : null;
      const batch = item.body.batch;
      const gone = [item];
      for (const i of items) {
        if (i.uuid === uuid) continue;
        if ((camera && i.body.camera === camera) || (batch && i.body.batch === batch)) gone.push(i);
      }
      for (const i of gone) await tx("readwrite", (s) => s.delete(i.uuid));
      debugEvent(`queue withdrew ${item.body.kind}`);
      await this.refresh();
      return gone;
    } finally {
      this.withheld.delete(uuid);
    }
  }

  /** Take every queued piece of a « Modifier » send out (refused, or withdrawn on the
   * server); never waits for a flush (the flush itself calls it). Their uuids. */
  async removeBatch(batch: string): Promise<string[]> {
    const items = await tx("readonly", (s) => s.getAll() as IDBRequest<Item[]>);
    const gone = items.filter((i) => i.body.batch === batch);
    for (const i of gone) await tx("readwrite", (s) => s.delete(i.uuid));
    if (gone.length) debugEvent(`queue removed ${gone.length} piece(s) of a send`);
    await this.refresh();
    return gone.map((i) => i.uuid);
  }

  /** A piece of this send left the phone since the page loaded (the server holds part
   * of it). Not known across a reload. */
  left(batch: string): boolean {
    return this.leftBatches.has(batch);
  }

  /** Whether the API said this contribution will be published on OSM in its author's name
   * once accepted (POST /api/contributions `osm: "will_publish"`). Not known across a
   * reload. */
  publishes(uuid: string): boolean {
    return this.willPublish.has(uuid);
  }

  /** Why the API said this contribution stays on Surveillance World although its author
   * publishes on OSM (POST /api/contributions `osm: "kept"`, `osm_reason`); undefined
   * otherwise. Not known across a reload. */
  keptReason(uuid: string): string | undefined {
    return this.keptReasons.get(uuid);
  }

  /** `watch` told of each contribution the API says stays on Surveillance World, and why;
   * the returned function stops it. */
  onKept(watch: (uuid: string, reason: string) => void): () => void {
    this.keptWatchers.add(watch);
    return () => this.keptWatchers.delete(watch);
  }

  /** `watch` told of each contribution the API says will be published on OSM from now on;
   * the returned function stops it. */
  onPublishes(watch: (uuid: string) => void): () => void {
    this.publishWatchers.add(watch);
    return () => this.publishWatchers.delete(watch);
  }

  /** A send refused by the server: the pieces that had already arrived are withdrawn, so
   * that none of it lands (best effort: offline, they stay pending, and its author can
   * still withdraw them), then its author is told. */
  private async refuse(batch: string): Promise<void> {
    try {
      await withdrawSent(batch);
    } catch (e) {
      // 404: nothing of it had arrived.
      if (!(e instanceof ApiError && e.status === 404))
        debugEvent(`queue refused send kept (${e})`);
    }
    this.onRefused(batch);
  }

  private held(item: Item): boolean {
    if (this.withheld.has(item.uuid)) return true;
    for (const u of this.withheld) {
      if (item.body.camera === addedId(u)) return true;
      const batch = this.items.find((i) => i.uuid === u)?.body.batch;
      if (batch && item.body.batch === batch) return true;
    }
    return false;
  }

  /** Send what waits, one at a time; concurrent calls share the same run, which goes once
   * more when one came meanwhile (an "online" event while a send is still failing: else
   * lost, the next try waited for the timer). Never again after a 401: a login resumes. */
  flush(why: string): Promise<void> {
    if (this.flushing) {
      this.again ??= why;
      return this.flushing;
    }
    this.flushing = (async () => {
      for (let reason: string | null = why; reason !== null; ) {
        this.again = null;
        await this.run(reason);
        reason = this.needsLogin ? null : this.again;
      }
    })().finally(() => {
      this.flushing = null;
      this.again = null;
    });
    return this.flushing;
  }

  private async run(why: string): Promise<void> {
    await this.refresh();
    if (!this.items.length) return;
    debugEvent(`queue flush (${why}): ${this.items.length} waiting`);
    const adds = this.items.filter((i) => i.body.kind === "add");
    const closed = new Set<string>(); // sends dropped during this run
    for (const item of [...adds, ...this.items.filter((i) => i.body.kind !== "add")]) {
      const batch = item.body.batch;
      if (this.held(item) || (batch && closed.has(batch))) continue;
      // An account's send leaves under that account's session only (who is signed in may
      // not be known yet at startup: it waits for onSession, which sends it then).
      if (item.owner && item.owner !== this.owner) continue;
      try {
        const answer = await call<{ osm?: string; osm_reason?: string } | null>(
          "POST",
          "/api/contributions",
          {
            ...item.body,
            uuid: item.uuid,
          },
        );
        if (answer?.osm === "will_publish") {
          this.willPublish.add(item.uuid);
          for (const w of this.publishWatchers) w(item.uuid);
        } else if (answer?.osm === "kept") {
          const reason = answer.osm_reason ?? "other";
          this.keptReasons.set(item.uuid, reason);
          for (const w of this.keptWatchers) w(item.uuid, reason);
        }
        if (batch) this.leftBatches.add(batch);
        await tx("readwrite", (s) => s.delete(item.uuid));
      } catch (e) {
        // Our own origin refused (a deploy's mistake, not the contribution's): kept, as when
        // the server is busy, never dropped.
        if (e instanceof ApiError && e.status === 403 && e.code === "origin") {
          await tx("readwrite", (s) => s.put({ ...item, tries: item.tries + 1 }));
          debugEvent(`queue keeps ${this.items.length} (403 origin)`);
          break;
        }
        if (e instanceof ApiError && e.status === 401) {
          // No session: nothing is dropped, nothing more is sent until a login.
          this.needsLogin = true;
          debugEvent(`queue keeps ${this.items.length} until a login (401 ${e.code})`);
          break;
        }
        if (e instanceof ApiError && !e.transient) {
          debugEvent(`queue drop ${e.status} ${e.code}`);
          if (batch) {
            // A piece of a « Modifier » send: the whole send goes, never part of it.
            closed.add(batch);
            this.dropped += (await this.removeBatch(batch)).length;
            // Withdrawn meanwhile (batch_closed): its author's own doing, nothing to say.
            if (e.code !== "batch_closed") await this.refuse(batch);
            continue;
          }
          this.dropped++;
          await tx("readwrite", (s) => s.delete(item.uuid));
          continue;
        }
        await tx("readwrite", (s) => s.put({ ...item, tries: item.tries + 1 }));
        debugEvent(`queue keeps ${this.items.length} (${isNetworkError(e) ? "offline" : e})`);
        break; // offline or server busy: the next ones would fail the same way
      }
    }
    await this.refresh();
    clearTimeout(this.timer);
    if (this.items.length && !this.needsLogin)
      this.timer = window.setTimeout(() => void this.flush("timer"), RETRY_MS);
  }
}

/** Today in the phone's time zone, as YYYY-MM-DD: the only date stored, never the time. */
export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The id of the camera an add creates: `c` + the first 12 hex digits of its uuid
 * (participation.added_id). */
export function addedId(uuid: string): string {
  return `c${uuid.replaceAll("-", "").slice(0, 12)}`;
}

/** An added camera's id (no OSM element): never n, w or r. */
export const isAdded = (id: string) => /^c[0-9a-f]{12}$/.test(id);
