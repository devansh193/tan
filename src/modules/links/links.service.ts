import { decodeCursor, encodeCursor, type Cursor } from "../../common/cursor";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../common/errors";
import { newPublicId } from "../../common/ids";
import { env } from "../../config/env";
import type { Url } from "../../db/schema";
import { assertSafeUrl } from "../../lib/safe-browsing";
import { CHANNELS } from "../analytics/attribution";
import { generateCode, isReservedCode } from "./codes";
import { linkCache, type LinkCache } from "./link-cache";
import { linksRepository, type LinkSort, type LinksRepository } from "./links.repository";

const PG_UNIQUE_VIOLATION = "23505";
const MAX_CODE_ATTEMPTS = 5;
const LINK_ID_PATTERN = /^link_[0-9A-Za-z]{24}$/;

/** A link as returned by the API. */
export interface LinkView {
  id: string;
  code: string;
  shortUrl: string;
  url: string;
  /** Per-platform share links, e.g. `{ instagram: "https://…/abc1234/ig" }`. */
  shareUrls: Record<string, string>;
  clicks: number;
  createdBy: string;
  expiresAt: Date | null;
  createdAt: Date;
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
  expiresAt?: Date;
}

export interface ListLinksInput {
  sort: LinkSort;
  order: "asc" | "desc";
  limit: number;
  cursor?: string;
}

const isUniqueViolation = (err: unknown) =>
  !!err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION;

/** A cursor's key must match the sort, or Postgres would 500 on the cast. */
const checkCursor = (raw: string, sort: LinkSort): Cursor => {
  const cursor = decodeCursor(raw);
  const valid =
    sort === "clicks"
      ? Number.isSafeInteger(cursor.k)
      : typeof cursor.k === "string" && !Number.isNaN(Date.parse(cursor.k));
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
    private readonly cache: Pick<LinkCache, "delete"> = linkCache,
  ) {}

  /** Creates a link with a custom or random code. */
  async create(actor: Actor, input: CreateLinkInput): Promise<LinkView> {
    if (input.code && isReservedCode(input.code)) throw new ConflictError("Code is reserved");
    await assertSafeUrl(input.url);

    const base = {
      publicId: newPublicId("link"),
      originalUrl: input.url,
      organizationId: actor.organizationId,
      userId: actor.userId,
      expiresAt: input.expiresAt,
    };

    if (input.code) {
      try {
        return this.toView(await this.repo.create({ ...base, code: input.code }));
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictError("Code already taken");
        throw err;
      }
    }

    // Random codes rarely collide; the unique constraint catches it and we retry.
    for (let attempt = 1; ; attempt++) {
      try {
        return this.toView(await this.repo.create({ ...base, code: generateCode() }));
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

  /** Soft-deletes a link. Members may delete only links they created. */
  async remove(actor: Actor, id: string): Promise<void> {
    const url = await this.find(actor.organizationId, id);
    if (!actor.canManageAll && url.userId !== actor.userId) {
      throw new ForbiddenError("Only organization admins can delete other members' links");
    }
    if (!(await this.repo.softDelete(url.id, actor.organizationId))) {
      throw new NotFoundError("Link not found");
    }
    this.cache.delete(url.code);
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
      shareUrls: Object.fromEntries(
        Object.entries(CHANNELS).map(([tag, name]) => [name, `${shortUrl}/${tag}`]),
      ),
      clicks: url.clickCount,
      createdBy: url.userId,
      expiresAt: url.expiresAt,
      createdAt: url.createdAt,
    };
  }
}

export const linksService = new LinksService(linksRepository);
