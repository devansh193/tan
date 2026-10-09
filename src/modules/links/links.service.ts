import { decodeCursor, encodeCursor, type Cursor } from "../../common/cursor";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../common/errors";
import { newPublicId } from "../../common/ids";
import { env } from "../../config/env";
import type { Url } from "../../db/schema";
import { assertSafeUrl } from "../../lib/safe-browsing";
import { CHANNELS } from "../analytics/attribution";
import { generateCode, isReservedCode } from "./codes";
import { linkStore, type LinkStore } from "./link-store";
import {
  linksRepository,
  type LinkSort,
  type LinksRepository,
  type UpdateLinkFields,
} from "./links.repository";
import { applyUtm, readUtm, type Utm, type UtmPatch } from "./utm";

const PG_UNIQUE_VIOLATION = "23505";
const MAX_CODE_ATTEMPTS = 5;
const LINK_ID_PATTERN = /^link_[0-9A-Za-z]{24}$/;
const MAX_URL_LENGTH = 2048;

/** A link as returned by the API. */
export interface LinkView {
  id: string;
  code: string;
  shortUrl: string;
  url: string;
  title: string | null;
  description: string | null;
  redirectType: 301 | 302;
  /** UTM params read back from `url` (the URL is the single source of truth). */
  utm: Utm;
  /** Share-tag clicks get that platform's utm_source/utm_medium at redirect time. */
  autoUtm: boolean;
  /** Per-platform share links, e.g. `{ instagram: "https://…/abc1234/ig" }`. */
  shareUrls: Record<string, string>;
  clicks: number;
  createdBy: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A keyset page. `nextCursor` is null on the last page. */
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

/** Who is acting, and whether they may manage every member's links. */
export interface Actor {
  organizationId: string;
  userId: string;
  canManageAll: boolean;
}

export interface CreateLinkInput {
  url: string;
  code?: string;
  title?: string;
  description?: string;
  expiresAt?: Date;
  redirectType?: 301 | 302;
  utm?: UtmPatch;
  autoUtm?: boolean;
}

export interface UpdateLinkInput {
  url?: string;
  code?: string;
  title?: string | null;
  description?: string | null;
  expiresAt?: Date | null;
  redirectType?: 301 | 302;
  utm?: UtmPatch;
  autoUtm?: boolean;
}

export interface ListLinksInput {
  sort: LinkSort;
  order: "asc" | "desc";
  limit: number;
  cursor?: string;
  q?: string;
  userId?: string;
}

const isUniqueViolation = (err: unknown) =>
  !!err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION;

/** Applies a UTM patch and enforces the URL length cap on the result. */
const withUtm = (url: string, utm?: UtmPatch): string => {
  const out = utm ? applyUtm(url, utm) : url;
  if (out.length > MAX_URL_LENGTH) {
    throw new BadRequestError("url: too long after adding UTM parameters (max 2048)");
  }
  return out;
};

/** Exactly what `Date#toISOString` emits; `Date.parse` alone accepts "1", "Mar 1", … */
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A cursor's key must match the sort, or Postgres would 500 on the cast. */
const checkCursor = (raw: string, sort: LinkSort): Cursor => {
  const cursor = decodeCursor(raw);
  const valid =
    sort === "clicks"
      ? Number.isSafeInteger(cursor.k)
      : typeof cursor.k === "string" &&
        ISO_MS.test(cursor.k) &&
        // Round-trip rejects impossible dates such as 2020-02-30.
        new Date(cursor.k).toISOString() === cursor.k;
  if (!valid) throw new BadRequestError("cursor: invalid");
  return cursor;
};

/**
 * Link management within an organization. Every link has exactly one code in a
 * single unique column, so a custom code can never shadow another link.
 */
export class LinksService {
  constructor(
    private readonly repo: LinksRepository,
    private readonly store: Pick<LinkStore, "invalidate"> = linkStore,
  ) {}

  /** Creates a link with a custom or random code. */
  async create(actor: Actor, input: CreateLinkInput): Promise<LinkView> {
    if (input.code && isReservedCode(input.code)) throw new ConflictError("Code is reserved");
    const url = withUtm(input.url, input.utm);
    await assertSafeUrl(url);

    const base = {
      publicId: newPublicId("link"),
      originalUrl: url,
      organizationId: actor.organizationId,
      userId: actor.userId,
      title: input.title,
      description: input.description,
      expiresAt: input.expiresAt,
      redirectType: input.redirectType,
      autoUtm: input.autoUtm,
    };

    if (input.code) {
      try {
        return this.created(await this.repo.create({ ...base, code: input.code }));
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictError("Code already taken");
        throw err;
      }
    }

    // Random codes rarely collide; the unique constraint catches it and we retry.
    for (let attempt = 1; ; attempt++) {
      try {
        return this.created(await this.repo.create({ ...base, code: generateCode() }));
      } catch (err) {
        if (!isUniqueViolation(err) || attempt >= MAX_CODE_ATTEMPTS) throw err;
      }
    }
  }

  /** One page of the organization's links. Fetches one extra row to detect more. */
  async list(organizationId: string, input: ListLinksInput): Promise<Page<LinkView>> {
    const cursor = input.cursor ? checkCursor(input.cursor, input.sort) : undefined;
    const rows = await this.repo.list({
      organizationId,
      sort: input.sort,
      order: input.order,
      limit: input.limit + 1,
      cursor,
      q: input.q,
      userId: input.userId,
    });
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > input.limit && last
        ? encodeCursor({
            k: input.sort === "clicks" ? last.clickCount : last.createdAt.toISOString(),
            id: last.publicId,
          })
        : null;
    return { data: page.map((row) => this.toView(row)), nextCursor };
  }

  /** One link of the organization. */
  async get(organizationId: string, id: string): Promise<LinkView> {
    return this.toView(await this.find(organizationId, id));
  }

  /** JSON-merge update. Members may edit only links they created. */
  async update(actor: Actor, id: string, input: UpdateLinkInput): Promise<LinkView> {
    const current = await this.find(actor.organizationId, id);
    if (!actor.canManageAll && current.userId !== actor.userId) {
      throw new ForbiddenError("Only organization admins can edit other members' links");
    }
    if (input.code && isReservedCode(input.code)) throw new ConflictError("Code is reserved");

    const fields: UpdateLinkFields = {};
    if (input.url !== undefined || input.utm) {
      const url = withUtm(input.url ?? current.originalUrl, input.utm);
      if (url !== current.originalUrl) await assertSafeUrl(url);
      fields.originalUrl = url;
    }
    if (input.code !== undefined) fields.code = input.code;
    if (input.title !== undefined) fields.title = input.title;
    if (input.description !== undefined) fields.description = input.description;
    if (input.expiresAt !== undefined) fields.expiresAt = input.expiresAt;
    if (input.redirectType !== undefined) fields.redirectType = input.redirectType;
    if (input.autoUtm !== undefined) fields.autoUtm = input.autoUtm;

    let row: Url | undefined;
    try {
      row = await this.repo.update(current.id, actor.organizationId, fields);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError("Code already taken");
      throw err;
    }
    if (!row) throw new NotFoundError("Link not found");
    // The old code is freed now; drop both so neither serves a stale target.
    await this.store.invalidate([...new Set([current.code, row.code])]);
    return this.toView(row);
  }

  /** Soft-deletes a link. Members may delete only links they created. */
  async remove(actor: Actor, id: string): Promise<void> {
    const url = await this.find(actor.organizationId, id);
    if (!actor.canManageAll && url.userId !== actor.userId) {
      throw new ForbiddenError("Only organization admins can delete other members' links");
    }
    if (!(await this.repo.softDelete(url.id, actor.organizationId))) {
      throw new NotFoundError("Link not found");
    }
    await this.store.invalidate([url.code]);
  }

  /** A brand-new code may be cached as a miss (someone tried it first): drop that. */
  private async created(row: Url): Promise<LinkView> {
    await this.store.invalidate([row.code]);
    return this.toView(row);
  }

  /** Org-scoped lookup; another org's link and a malformed id are both 404. */
  private async find(organizationId: string, id: string): Promise<Url> {
    const url = LINK_ID_PATTERN.test(id)
      ? await this.repo.findByPublicId(organizationId, id)
      : undefined;
    if (!url) throw new NotFoundError("Link not found");
    return url;
  }

  /** Maps a DB row to the API shape. */
  private toView(url: Url): LinkView {
    const shortUrl = `${env.BASE_URL}/${url.code}`;
    return {
      id: url.publicId,
      code: url.code,
      shortUrl,
      url: url.originalUrl,
      title: url.title,
      description: url.description,
      redirectType: url.redirectType === 301 ? 301 : 302,
      utm: readUtm(url.originalUrl),
      autoUtm: url.autoUtm,
      shareUrls: Object.fromEntries(
        Object.entries(CHANNELS).map(([tag, name]) => [name, `${shortUrl}/${tag}`]),
      ),
      clicks: url.clickCount,
      createdBy: url.userId,
      expiresAt: url.expiresAt,
      createdAt: url.createdAt,
      updatedAt: url.updatedAt,
    };
  }
}

export const linksService = new LinksService(linksRepository);
